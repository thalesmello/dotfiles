// Use ~/src/dotfiles/bin/claude-file-suggestion (rg + fzf) for `@` file completion.
//
// The script reads `{"query": "..."}` on stdin and prints newline-separated
// project-relative paths. We shell out to it for every `@...` token and fall
// back to pi's built-in fuzzy file provider when it yields nothing.

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";

const COMMAND = "claude-file-suggestion";
const MAX_SUGGESTIONS = 20;
const TIMEOUT_MS = 5_000;

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

/** Returns the `@...` token that ends at the cursor, or null. */
function extractAtPrefix(text: string): string | null {
	let tokenStart = 0;
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) {
			tokenStart = i + 1;
			break;
		}
	}
	// Support @"quoted paths with spaces"
	if (tokenStart >= 2 && text[tokenStart - 1] === '"' && text[tokenStart - 2] === "@") {
		return text.slice(tokenStart - 2);
	}
	return text[tokenStart] === "@" ? text.slice(tokenStart) : null;
}

function queryFromPrefix(atPrefix: string): string {
	const raw = atPrefix.startsWith('@"') ? atPrefix.slice(2) : atPrefix.slice(1);
	return raw.replace(/"/g, "");
}

function completionValue(path: string): string {
	return path.includes(" ") ? `@"${path}"` : `@${path}`;
}

function toItem(path: string): AutocompleteItem {
	const name = path.split("/").pop() || path;
	return { value: completionValue(path), label: name, description: path };
}

function runScript(query: string, cwd: string, signal: AbortSignal): Promise<string[]> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve([]);
			return;
		}

		const child = spawn(COMMAND, [], {
			cwd,
			stdio: ["pipe", "pipe", "ignore"],
			env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
		});

		let stdout = "";
		let done = false;
		const finish = (paths: string[]) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			resolve(paths);
		};
		const kill = () => {
			if (child.exitCode === null) child.kill("SIGKILL");
		};
		const onAbort = () => kill();
		const timer = setTimeout(() => {
			kill();
			finish([]);
		}, TIMEOUT_MS);

		signal.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf-8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", () => finish([]));
		child.on("close", () => {
			if (signal.aborted) {
				finish([]);
				return;
			}
			finish(
				stdout
					.split("\n")
					.map((line) => line.trim().replace(/^\.\//, ""))
					.filter(Boolean)
					.slice(0, MAX_SUGGESTIONS),
			);
		});

		child.stdin.on("error", () => {});
		child.stdin.end(JSON.stringify({ query }));
	});
}

function createProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const textBeforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const atPrefix = extractAtPrefix(textBeforeCursor);
			if (atPrefix === null) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const paths = await runScript(queryFromPrefix(atPrefix), cwd, options.signal);
			if (options.signal.aborted || paths.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return { items: paths.map(toItem), prefix: atPrefix };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createProvider(current, ctx.cwd));
	});
}
