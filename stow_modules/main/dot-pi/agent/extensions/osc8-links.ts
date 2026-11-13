import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as piTui from "@earendil-works/pi-tui";

const PATCH_STATE_SYMBOL = Symbol.for("pi.osc8Links.patchState");
const PATH_STATE_SYMBOL = Symbol.for("pi.osc8Links.pathState");
const OSC8_CLOSE = "\x1b]8;;\x1b\\";

// Matches a complete raw OSC 8 sequence: ESC ] 8 ; params ; url (BEL | ST) text ESC ] 8 ; ; (BEL | ST)
const RAW_OSC8_GLOBAL_REGEX =
	/\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]+)(?:\x07|\x1b\\)([\s\S]*?)\x1b\]8;;(?:\x07|\x1b\\)/g;

const RAW_OSC8_BACKTICK_REGEX =
	/`+\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]+)(?:\x07|\x1b\\)([^`\x07\x1b]*?)\x1b\]8;;(?:\x07|\x1b\\)`+/g;

const RAW_OSC8_OPEN_FILE_URL_REGEX =
	/\x1b\]8;([^;\x07\x1b]*);(file:\/\/[^\x07\x1b]+)(\x07|\x1b\\)/gi;

// Matches candidate http(s) URLs in plain text, including inline placeholders like <redacted> inside URLs.
const PLAIN_URL_Candidate_REGEX =
	/https?:\/\/(?:<[a-zA-Z0-9_.:-]+>|[^\s<>"'`\x00-\x1f\x7f│┌┐└┘├┤┬┴┼─])+/gi;

const PLAIN_FILE_URL_CANDIDATE_REGEX =
	/file:\/\/[^\s<>"'`\x00-\x1f\x7f│┌┐└┘├┤┬┴┼─]+/gi;

// Matches candidate file/directory paths in plain text (mirrors rxpick's BUILTIN_PATH_RE, plus optional leading `…/`).
const PLAIN_PATH_CANDIDATE_REGEX =
	/(?:…\/|~\/|\.\.?\/|\/+)?\.?[A-Za-z0-9_][\w./+@%-]*[\w]/g;

const PATHISH_EXTENSION_OR_SLASH_REGEX =
	/\/|(?<!\.)\.[A-Za-z][A-Za-z0-9]{0,9}$/;

const SCHEME_PREFIX_REGEX =
	/(?:https?|ftp|file|mailto|ssh|git|npm|hammerspoon|tot):$/i;

const LINE_COL_SUFFIX_REGEX =
	/^(.*?):(\d+)(?:(?::|-)(\d+))?$/;

const HTML_LAYOUT_TAG_REGEX =
	/^<\/?(?:br|wbr|hr|p|div|span|a|img|code|pre|em|strong|b|i|u|s|del|ins|sub|sup|td|th|tr|table)\b/i;

const HTML_BR_TAG_REGEX = /^<\/?br\s*\/?>$/i;
const HTML_BR_CONTAINS_REGEX = /<\/?br\s*\/?>/i;

const HTML_ANCHOR_REGEX = /^<a\s+[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>$/i;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cjkBreakRegex =
	/[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

export interface UrlMatch {
	start: number;
	end: number;
	url: string;
}

export interface ParsedFileHyperlink {
	filePath: string;
	kind: "file" | "directory" | "path";
}

const FILE_STAT_CACHE_TTL_MS = 2000;
const FILE_STAT_CACHE_MAX_SIZE = 2048;

type SharedPathState = {
	sessionCwd: string;
	fileStatCache: Map<string, { kind: "file" | "directory" | null; expiresAt: number }>;
	knownPathsBySuffix: Map<string, string>;
	indexedSessionFiles: Set<string>;
};

function getSharedPathState(): SharedPathState {
	const holder = globalThis as Record<symbol, SharedPathState | undefined>;
	if (!holder[PATH_STATE_SYMBOL]) {
		holder[PATH_STATE_SYMBOL] = {
			sessionCwd: process.cwd(),
			fileStatCache: new Map(),
			knownPathsBySuffix: new Map(),
			indexedSessionFiles: new Set(),
		};
	}
	return holder[PATH_STATE_SYMBOL]!;
}

export function isHerdrOrHcSession(env: NodeJS.ProcessEnv = process.env): boolean {
	return (
		env.HERDR_ENV === "1" ||
		Boolean(env.HERDR_PANE_ID) ||
		Boolean(env.HERDR_ACTIVE_PANE_ID) ||
		Boolean(env.HC_TERMINAL_ID)
	);
}

export function getSessionCwd(): string {
	return getSharedPathState().sessionCwd || process.cwd();
}

export function setSessionCwd(cwd: string | undefined): void {
	if (cwd && cwd.trim()) {
		const state = getSharedPathState();
		state.sessionCwd = cwd;
		state.fileStatCache.clear();
	}
}

export function clearKnownFilePaths(): void {
	const state = getSharedPathState();
	state.knownPathsBySuffix.clear();
	state.fileStatCache.clear();
	state.indexedSessionFiles.clear();
}

export function formatHerdrFileHyperlinkUrl(
	filePath: string,
	kind: "file" | "directory" | "path" = "file",
): string {
	return `hammerspoon://workflow-preset/open-selection?type=${encodeURIComponent(kind)}&match=${encodeURIComponent(filePath)}`;
}

function expandHomePath(rawPath: string, home = homedir()): string {
	if (rawPath === "~") return home;
	if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
		return join(home, rawPath.slice(2));
	}
	return rawPath;
}

function indexKnownFilePath(absPath: string): void {
	const { knownPathsBySuffix } = getSharedPathState();
	const normalized = absPath.replace(/\\/g, "/");
	const parts = normalized.split("/").filter(Boolean);
	if (parts.length === 0) return;

	let suffix = "";
	for (let i = parts.length - 1; i >= 0; i--) {
		suffix = suffix ? `${parts[i]}/${suffix}` : parts[i]!;
		knownPathsBySuffix.set(suffix, absPath);
	}
}

function statExistingPath(absPath: string): "file" | "directory" | null {
	const { fileStatCache } = getSharedPathState();
	const now = Date.now();
	const cached = fileStatCache.get(absPath);
	if (cached && cached.expiresAt > now) {
		return cached.kind;
	}

	let kind: "file" | "directory" | null = null;
	try {
		const st = statSync(absPath);
		if (st.isFile()) kind = "file";
		else if (st.isDirectory()) kind = "directory";
	} catch {
		kind = null;
	}

	if (fileStatCache.size >= FILE_STAT_CACHE_MAX_SIZE) {
		fileStatCache.clear();
	}
	fileStatCache.set(absPath, { kind, expiresAt: now + FILE_STAT_CACHE_TTL_MS });
	if (kind) {
		indexKnownFilePath(absPath);
	}
	return kind;
}

function stripOptionalLineColSuffix(filePath: string): string {
	const m = LINE_COL_SUFFIX_REGEX.exec(filePath);
	if (!m || !m[1]) return filePath;
	if (statExistingPath(filePath) !== null) return filePath;
	if (statExistingPath(m[1]) !== null) return m[1];
	return m[1];
}

export function registerKnownFilePath(
	rawPath: string | undefined | null,
	cwd: string = getSessionCwd(),
): string | undefined {
	if (typeof rawPath !== "string") return undefined;
	let trimmed = rawPath.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith("@") && trimmed.length > 1) {
		trimmed = trimmed.slice(1);
	}
	if (/^file:\/\//i.test(trimmed)) {
		const parsed = parseFileHyperlinkUrl(trimmed);
		if (!parsed) return undefined;
		trimmed = parsed.filePath;
	}
	const expanded = expandHomePath(trimmed);
	const resolved = isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
	const clean = stripOptionalLineColSuffix(resolved);
	indexKnownFilePath(clean);
	statExistingPath(clean);
	return clean;
}

export function resolveToolPathHyperlinkUrl(
	rawPath: string | undefined | null,
	cwd: string = getSessionCwd(),
	env: NodeJS.ProcessEnv = process.env,
): string | undefined {
	const absPath = registerKnownFilePath(rawPath, cwd);
	if (!absPath) return undefined;
	if (isHerdrOrHcSession(env)) {
		const kind = statExistingPath(absPath) ?? "file";
		return formatHerdrFileHyperlinkUrl(absPath, kind);
	}
	return pathToFileURL(absPath).href;
}

function looksLikePathCandidate(candidate: string): boolean {
	if (!candidate || candidate.length < 2) return false;
	if (!PATHISH_EXTENSION_OR_SLASH_REGEX.test(candidate)) return false;
	if (candidate.includes("..") && !/(?:^\.\.\/|\/\.\.(?:\/|$))/.test(candidate)) {
		return false;
	}
	return true;
}

export function resolveCandidateFilePath(
	rawCandidate: string,
	cwd: string = getSessionCwd(),
): ParsedFileHyperlink | undefined {
	if (!rawCandidate) return undefined;
	const candidate = rawCandidate.startsWith("…/") ? rawCandidate.slice(2) : rawCandidate;
	if (!looksLikePathCandidate(candidate)) return undefined;

	const hasSlash = candidate.includes("/");
	if (!rawCandidate.startsWith("…/")) {
		const expanded = expandHomePath(candidate);
		const absPath = isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
		const kind = statExistingPath(absPath);
		if (kind === "file" || (kind === "directory" && hasSlash)) {
			return { filePath: absPath, kind };
		}
	}

	const { knownPathsBySuffix } = getSharedPathState();
	const normalizedKey = candidate.replace(/^\.\//, "");
	const knownAbs = knownPathsBySuffix.get(normalizedKey);
	if (knownAbs) {
		const kind = statExistingPath(knownAbs);
		if (kind === "file" || (kind === "directory" && hasSlash)) {
			return { filePath: knownAbs, kind };
		}
	}

	return undefined;
}

export function parseFileHyperlinkUrl(url: string): ParsedFileHyperlink | undefined {
	if (!url) return undefined;

	if (/^hammerspoon:\/\/workflow-preset\/open-selection(?:\?|$)/i.test(url)) {
		try {
			const parsed = new URL(url);
			const rawType = (parsed.searchParams.get("type") || "file").toLowerCase();
			const rawMatch = parsed.searchParams.get("match");
			if (!rawMatch) return undefined;
			if (rawType !== "file" && rawType !== "directory" && rawType !== "path") {
				return undefined;
			}
			const expanded = expandHomePath(rawMatch);
			const absPath = isAbsolute(expanded) ? normalize(expanded) : resolve(getSessionCwd(), expanded);
			const cleanPath = stripOptionalLineColSuffix(absPath);
			const statKind = statExistingPath(cleanPath);
			const kind: "file" | "directory" | "path" =
				statKind ?? (rawType === "directory" ? "directory" : rawType === "path" ? "path" : "file");
			return { filePath: cleanPath, kind };
		} catch {
			return undefined;
		}
	}

	if (/^file:\/\//i.test(url)) {
		try {
			const withoutHashOrQuery = url.split("#")[0]!.split("?")[0]!;
			let filePath: string;
			try {
				filePath = fileURLToPath(withoutHashOrQuery);
			} catch {
				const parsed = new URL(withoutHashOrQuery);
				filePath = decodeURIComponent(parsed.pathname);
			}
			if (!filePath) return undefined;
			const cleanPath = stripOptionalLineColSuffix(normalize(filePath));
			const statKind = statExistingPath(cleanPath);
			return {
				filePath: cleanPath,
				kind: statKind === "directory" ? "directory" : "file",
			};
		} catch {
			return undefined;
		}
	}

	return undefined;
}

export function isFileHyperlinkUrl(url: string): boolean {
	return parseFileHyperlinkUrl(url) !== undefined;
}

export function rewriteUrlForHerdr(url: string, env: NodeJS.ProcessEnv = process.env): string {
	if (!url || !isHerdrOrHcSession(env)) return url;
	if (/^file:\/\//i.test(url)) {
		const parsed = parseFileHyperlinkUrl(url);
		if (parsed) {
			return formatHerdrFileHyperlinkUrl(parsed.filePath, parsed.kind);
		}
	}
	return url;
}

export function resolveMarkdownLinkHref(
	rawHref: string,
	cwd: string = getSessionCwd(),
	env: NodeJS.ProcessEnv = process.env,
): string {
	if (!rawHref || !isHerdrOrHcSession(env)) return rawHref;
	if (/^file:\/\//i.test(rawHref)) {
		return rewriteUrlForHerdr(rawHref, env);
	}
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rawHref) || rawHref.startsWith("#")) {
		return rawHref;
	}
	const withoutFragment = rawHref.split("#")[0]!.split("?")[0]!.trim();
	if (!withoutFragment) return rawHref;
	const cleanCandidate = LINE_COL_SUFFIX_REGEX.exec(withoutFragment)?.[1] || withoutFragment;
	const resolved = resolveCandidateFilePath(cleanCandidate, cwd);
	if (resolved) {
		return formatHerdrFileHyperlinkUrl(resolved.filePath, resolved.kind);
	}
	if (
		(cleanCandidate.startsWith("/") ||
			cleanCandidate.startsWith("~/") ||
			cleanCandidate.startsWith("./") ||
			cleanCandidate.startsWith("../")) &&
		looksLikePathCandidate(cleanCandidate)
	) {
		const expanded = expandHomePath(cleanCandidate);
		const absPath = isAbsolute(expanded) ? normalize(expanded) : resolve(cwd, expanded);
		return formatHerdrFileHyperlinkUrl(absPath, "file");
	}
	return rawHref;
}

function countChar(str: string, ch: string): number {
	let count = 0;
	for (let i = 0; i < str.length; i++) {
		if (str[i] === ch) count++;
	}
	return count;
}

export function splitTrailingUrlPunctuation(rawUrl: string): { url: string; trailing: string } {
	let url = rawUrl;
	let trailing = "";

	while (url.length > 0) {
		const inlineTagMatch = /(<[a-zA-Z0-9_.:-]+>)$/.exec(url);
		if (inlineTagMatch && HTML_LAYOUT_TAG_REGEX.test(inlineTagMatch[1])) {
			const tag = inlineTagMatch[1];
			url = url.slice(0, -tag.length);
			trailing = tag + trailing;
			continue;
		}

		const last = url[url.length - 1]!;
		if (".!?,;:'\"".includes(last)) {
			url = url.slice(0, -1);
			trailing = last + trailing;
			continue;
		}
		if (last === ")" && countChar(url, ")") > countChar(url, "(")) {
			url = url.slice(0, -1);
			trailing = last + trailing;
			continue;
		}
		if (last === "]" && countChar(url, "]") > countChar(url, "[")) {
			url = url.slice(0, -1);
			trailing = last + trailing;
			continue;
		}
		if (last === "}" && countChar(url, "}") > countChar(url, "{")) {
			url = url.slice(0, -1);
			trailing = last + trailing;
			continue;
		}
		break;
	}

	return { url, trailing };
}

export function findUrlsInPlainText(text: string): UrlMatch[] {
	if (!text) return [];
	const inHerdr = isHerdrOrHcSession();
	const hasHttp = text.includes("http://") || text.includes("https://") || /https?:\/\//i.test(text);
	const hasFileUrl = inHerdr && (text.includes("file://") || /file:\/\//i.test(text));
	const hasPathChars = inHerdr && (text.includes("/") || text.includes("."));

	if (!hasHttp && !hasFileUrl && !hasPathChars) {
		return [];
	}

	const matches: UrlMatch[] = [];
	let match: RegExpExecArray | null;

	if (hasHttp) {
		PLAIN_URL_Candidate_REGEX.lastIndex = 0;
		while ((match = PLAIN_URL_Candidate_REGEX.exec(text)) !== null) {
			const { url } = splitTrailingUrlPunctuation(match[0]);
			if (url.length > "https://".length) {
				matches.push({
					start: match.index,
					end: match.index + url.length,
					url,
				});
			}
		}
	}

	if (hasFileUrl) {
		PLAIN_FILE_URL_CANDIDATE_REGEX.lastIndex = 0;
		while ((match = PLAIN_FILE_URL_CANDIDATE_REGEX.exec(text)) !== null) {
			const { url } = splitTrailingUrlPunctuation(match[0]);
			if (url.length > "file:///".length) {
				const start = match.index;
				const end = match.index + url.length;
				if (matches.some((m) => start < m.end && end > m.start)) continue;
				matches.push({
					start,
					end,
					url: rewriteUrlForHerdr(url),
				});
			}
		}
	}

	if (hasPathChars) {
		PLAIN_PATH_CANDIDATE_REGEX.lastIndex = 0;
		while ((match = PLAIN_PATH_CANDIDATE_REGEX.exec(text)) !== null) {
			const candidate = match[0];
			const start = match.index;
			const end = start + candidate.length;

			if (matches.some((m) => start < m.end && end > m.start)) continue;

			if (start > 0) {
				const prev = text[start - 1]!;
				if (/[\w/~.%+-]/.test(prev)) continue;
				if (prev === "@" && start >= 2 && /[\w.]/.test(text[start - 2]!)) continue;
				if (prev === ":") {
					const beforeColon = text.slice(Math.max(0, start - 20), start);
					if (SCHEME_PREFIX_REGEX.test(beforeColon)) continue;
				}
			}

			if (text.slice(end, end + 3) === "://") continue;

			const resolved = resolveCandidateFilePath(candidate);
			if (resolved) {
				const lineSuffix = /^:\d+(?:(?::|-)\d+)?(?![\w.])/.exec(text.slice(end));
				const matchEnd = lineSuffix ? end + lineSuffix[0].length : end;
				matches.push({
					start,
					end: matchEnd,
					url: formatHerdrFileHyperlinkUrl(resolved.filePath, resolved.kind),
				});
			}
		}
	}

	if (matches.length > 1) {
		matches.sort((a, b) => a.start - b.start);
	}

	return matches;
}

export function formatOsc8(text: string, url: string, params = ""): string {
	if (!text) return text;
	return `\x1b]8;${params};${url}\x1b\\${text}${OSC8_CLOSE}`;
}

export function linkifyPlainTextUrls(
	text: string,
	renderUrl: (urlText: string, url: string) => string = (urlText, url) => formatOsc8(urlText, url),
	renderNonUrl: (chunk: string) => string = (chunk) => chunk,
): string {
	const matches = findUrlsInPlainText(text);
	if (matches.length === 0) {
		return renderNonUrl(text);
	}

	let result = "";
	let cursor = 0;
	for (const match of matches) {
		if (match.start > cursor) {
			result += renderNonUrl(text.slice(cursor, match.start));
		}
		const urlText = text.slice(match.start, match.end);
		result += renderUrl(urlText, match.url);
		cursor = match.end;
	}
	if (cursor < text.length) {
		result += renderNonUrl(text.slice(cursor));
	}
	return result;
}

export function ansiCodeLength(str: string, pos: number): number {
	if (pos >= str.length || str.charCodeAt(pos) !== 27) return 0;
	const next = str[pos + 1];
	if (next === "[") {
		for (let j = pos + 2; j < str.length; j++) {
			const c = str.charCodeAt(j);
			if (c === 109 || c === 71 || c === 75 || c === 72 || c === 74) {
				return j + 1 - pos;
			}
		}
		return 0;
	}
	if (next === "]" || next === "_") {
		for (let j = pos + 2; j < str.length; j++) {
			const c = str.charCodeAt(j);
			if (c === 7) return j + 1 - pos;
			if (c === 27 && str[j + 1] === "\\") return j + 2 - pos;
		}
		return 0;
	}
	return 0;
}

export function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	const length = ansiCodeLength(str, pos);
	return length > 0 ? { code: str.substring(pos, pos + length), length } : null;
}

export interface ParsedOsc8 {
	params: string;
	url: string;
	terminator: string;
}

export function parseOsc8Code(ansiCode: string): ParsedOsc8 | null | undefined {
	if (!ansiCode.startsWith("\x1b]8;")) return undefined;
	const terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1b\\";
	const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
	const sep = body.indexOf(";");
	if (sep === -1) return undefined;
	const params = body.slice(0, sep);
	const url = body.slice(sep + 1);
	if (!url) return null;
	return { params, url, terminator };
}

/**
 * Finds bare http(s) URLs (and file paths when in Herdr/hc) in an ANSI-styled string where no OSC 8
 * hyperlink is active and wraps their exact character ranges in OSC 8 hyperlinks while preserving all SGR colors.
 */
export function linkifyAnsiLineUrls(line: string, styleUrlPrefix = "\x1b[4m", styleUrlSuffix = "\x1b[24m"): string {
	if (!line) return line;

	const inHerdr = isHerdrOrHcSession();
	let workingLine = line;
	if (inHerdr && workingLine.includes("\x1b]8;") && /file:\/\//i.test(workingLine)) {
		workingLine = workingLine.replace(
			RAW_OSC8_OPEN_FILE_URL_REGEX,
			(_full, params: string, rawFileUrl: string, terminator: string) => {
				return `\x1b]8;${params};${rewriteUrlForHerdr(rawFileUrl)}${terminator}`;
			},
		);
	}

	if (inHerdr) {
		if (
			!workingLine.includes("/") &&
			!workingLine.includes(".") &&
			!workingLine.includes("http://") &&
			!workingLine.includes("https://") &&
			!/https?:\/\/|file:\/\//i.test(workingLine)
		) {
			return workingLine;
		}
	} else if (
		!workingLine.includes("http://") &&
		!workingLine.includes("https://") &&
		!/https?:\/\//i.test(workingLine)
	) {
		return workingLine;
	}

	// Build plain text and map each plain character index to whether an OSC 8 link or underline is already active.
	let plain = "";
	const charHasOsc8: boolean[] = [];
	const charHasUnderline: boolean[] = [];
	const tracker = new AnsiTracker();
	let i = 0;

	while (i < workingLine.length) {
		const ansi = extractAnsiCode(workingLine, i);
		if (ansi) {
			tracker.process(ansi.code);
			i += ansi.length;
			continue;
		}
		plain += workingLine[i];
		charHasOsc8.push(tracker.activeHyperlink !== null);
		charHasUnderline.push(tracker.underline);
		i++;
	}

	const urlMatches = findUrlsInPlainText(plain).filter((m) => {
		for (let idx = m.start; idx < m.end; idx++) {
			if (charHasOsc8[idx]) return false;
		}
		return true;
	});

	if (urlMatches.length === 0) {
		return workingLine;
	}

	const openAtPlainIdx = new Map<number, string>();
	const closeAtPlainIdx = new Map<number, boolean>();
	for (const match of urlMatches) {
		openAtPlainIdx.set(match.start, match.url);
		closeAtPlainIdx.set(match.end, true);
	}

	let out = "";
	let plainIdx = 0;
	let addedUnderlineForUrl = false;
	i = 0;
	while (i < workingLine.length) {
		const ansi = extractAnsiCode(workingLine, i);
		if (ansi) {
			out += ansi.code;
			if (addedUnderlineForUrl && /^\x1b\[(?:0|24)(?:;[\d;]*)*m$/.test(ansi.code)) {
				out += styleUrlPrefix;
			}
			i += ansi.length;
			continue;
		}

		const openUrl = openAtPlainIdx.get(plainIdx);
		if (openUrl !== undefined) {
			const isFileLink = isFileHyperlinkUrl(openUrl);
			const needsPrefix =
				!isFileLink &&
				Boolean(styleUrlPrefix) &&
				!(styleUrlPrefix === "\x1b[4m" && charHasUnderline[plainIdx]);
			addedUnderlineForUrl = needsPrefix;
			out += `\x1b]8;;${openUrl}\x1b\\${needsPrefix ? styleUrlPrefix : ""}`;
		}

		out += workingLine[i];
		plainIdx++;
		i++;

		if (closeAtPlainIdx.get(plainIdx)) {
			const closeSuffix = addedUnderlineForUrl ? styleUrlSuffix : "";
			addedUnderlineForUrl = false;
			out += `${closeSuffix}${OSC8_CLOSE}`;
		}
	}

	return out;
}

export function linkifyAnsiTextUrls(text: string, styleUrlPrefix = "\x1b[4m", styleUrlSuffix = "\x1b[24m"): string {
	if (!text) return text;
	if (!isHerdrOrHcSession()) {
		if (!text.includes("http://") && !text.includes("https://") && !/https?:\/\//i.test(text)) {
			return text;
		}
	} else if (
		!text.includes("/") &&
		!text.includes(".") &&
		!text.includes("http://") &&
		!text.includes("https://") &&
		!/https?:\/\/|file:\/\//i.test(text)
	) {
		return text;
	}
	return text
		.split("\n")
		.map((line) => linkifyAnsiLineUrls(line, styleUrlPrefix, styleUrlSuffix))
		.join("\n");
}

function escapeMarkdownLinkLabel(label: string): string {
	return label.replace(/([[\]])/g, "\\$1");
}

export function normalizeMarkdownForOsc8(markdown: string): string {
	if (!markdown || !markdown.includes("\x1b]8;")) {
		return markdown;
	}

	const lines = markdown.split("\n");
	let inFence: { char: string; length: number } | null = null;

	return lines
		.map((line) => {
			const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
			if (fenceMatch) {
				const marker = fenceMatch[1]!;
				const char = marker[0]!;
				if (!inFence) {
					inFence = { char, length: marker.length };
					return line;
				}
				if (inFence.char === char && marker.length >= inFence.length && /^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(line)) {
					inFence = null;
					return line;
				}
			}

			if (inFence || !line.includes("\x1b]8;")) {
				return line;
			}

			// 1. Convert `\x1b]8;;url\x1b\\label\x1b]8;;\x1b\\` inside backticks to [`label`](url)
			let normalized = line.replace(RAW_OSC8_BACKTICK_REGEX, (_full, _params: string, url: string, label: string) => {
				const cleanUrl = url.trim();
				const cleanLabel = (label || cleanUrl).trim();
				return `[\`${cleanLabel}\`](${cleanUrl})`;
			});

			// 2. Convert remaining raw OSC 8 sequences to [label](url)
			normalized = normalized.replace(RAW_OSC8_GLOBAL_REGEX, (_full, _params: string, url: string, label: string) => {
				const cleanUrl = url.trim();
				const cleanLabel = stripTerminalSequencesSafe(label).trim() || cleanUrl;
				return `[${escapeMarkdownLinkLabel(cleanLabel)}](${cleanUrl})`;
			});

			return normalized;
		})
		.join("\n");
}

function stripTerminalSequencesSafe(str: string): string {
	if (!str.includes("\x1b")) return str;
	let result = "";
	let i = 0;
	while (i < str.length) {
		const ansi = extractAnsiCode(str, i);
		if (ansi) {
			i += ansi.length;
			continue;
		}
		result += str[i];
		i++;
	}
	return result;
}

class AnsiTracker {
	bold = false;
	dim = false;
	italic = false;
	underline = false;
	blink = false;
	inverse = false;
	hidden = false;
	strikethrough = false;
	fgColor: string | null = null;
	bgColor: string | null = null;
	activeHyperlink: ParsedOsc8 | null = null;

	process(ansiCode: string): void {
		const hyperlink = parseOsc8Code(ansiCode);
		if (hyperlink !== undefined) {
			this.activeHyperlink = hyperlink;
			return;
		}
		if (!ansiCode.endsWith("m")) return;
		const match = ansiCode.match(/^\x1b\[([\d;]*)m$/);
		if (!match) return;
		const params = match[1]!;
		if (params === "" || params === "0") {
			this.reset();
			return;
		}
		const parts = params.split(";");
		let i = 0;
		while (i < parts.length) {
			const code = Number.parseInt(parts[i]!, 10);
			if (code === 38 || code === 48) {
				if (parts[i + 1] === "5" && parts[i + 2] !== undefined) {
					const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
					if (code === 38) this.fgColor = colorCode;
					else this.bgColor = colorCode;
					i += 3;
					continue;
				}
				if (parts[i + 1] === "2" && parts[i + 4] !== undefined) {
					const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
					if (code === 38) this.fgColor = colorCode;
					else this.bgColor = colorCode;
					i += 5;
					continue;
				}
			}
			switch (code) {
				case 0:
					this.reset();
					break;
				case 1:
					this.bold = true;
					break;
				case 2:
					this.dim = true;
					break;
				case 3:
					this.italic = true;
					break;
				case 4:
					this.underline = true;
					break;
				case 5:
					this.blink = true;
					break;
				case 7:
					this.inverse = true;
					break;
				case 8:
					this.hidden = true;
					break;
				case 9:
					this.strikethrough = true;
					break;
				case 21:
					this.bold = false;
					break;
				case 22:
					this.bold = false;
					this.dim = false;
					break;
				case 23:
					this.italic = false;
					break;
				case 24:
					this.underline = false;
					break;
				case 25:
					this.blink = false;
					break;
				case 27:
					this.inverse = false;
					break;
				case 28:
					this.hidden = false;
					break;
				case 29:
					this.strikethrough = false;
					break;
				case 39:
					this.fgColor = null;
					break;
				case 49:
					this.bgColor = null;
					break;
				default:
					if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
						this.fgColor = String(code);
					} else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
						this.bgColor = String(code);
					}
					break;
			}
			i++;
		}
	}

	reset(): void {
		this.bold = false;
		this.dim = false;
		this.italic = false;
		this.underline = false;
		this.blink = false;
		this.inverse = false;
		this.hidden = false;
		this.strikethrough = false;
		this.fgColor = null;
		this.bgColor = null;
	}

	getActiveCodes(): string {
		const codes: string[] = [];
		if (this.bold) codes.push("1");
		if (this.dim) codes.push("2");
		if (this.italic) codes.push("3");
		if (this.underline) codes.push("4");
		if (this.blink) codes.push("5");
		if (this.inverse) codes.push("7");
		if (this.hidden) codes.push("8");
		if (this.strikethrough) codes.push("9");
		if (this.fgColor) codes.push(this.fgColor);
		if (this.bgColor) codes.push(this.bgColor);
		let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
		if (this.activeHyperlink) {
			result += `\x1b]8;${this.activeHyperlink.params};${this.activeHyperlink.url}${this.activeHyperlink.terminator}`;
		}
		return result;
	}

	getLineEndReset(): string {
		let result = "";
		if (this.underline) {
			result += "\x1b[24m";
		}
		if (this.activeHyperlink) {
			result += `\x1b]8;;${this.activeHyperlink.terminator}`;
		}
		return result;
	}
}

function updateTrackerFromText(text: string, tracker: AnsiTracker): void {
	let i = text.indexOf("\x1b");
	while (i !== -1) {
		const length = ansiCodeLength(text, i);
		if (length > 0) {
			tracker.process(text.substring(i, i + length));
			i += length;
		} else {
			i++;
		}
		i = text.indexOf("\x1b", i);
	}
}

function isClosingAnsiSequence(code: string): boolean {
	const osc8 = parseOsc8Code(code);
	if (osc8 !== undefined) {
		return osc8 === null;
	}
	return /^\x1b\[(?:0|21|22|23|24|25|27|28|29|39|49)(?:;(?:0|21|22|23|24|25|27|28|29|39|49))*m$/.test(code);
}

function splitIntoTokensWithAnsiFixed(text: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let pendingAnsi = "";
	let currentKind: "space" | "word" | null = null;
	let i = 0;

	const flushCurrent = () => {
		if (!current) return;
		tokens.push(current);
		current = "";
		currentKind = null;
	};

	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			// Keep closing SGR/OSC8 sequences attached to the word they close so
			// subsequent space tokens remain pure whitespace.
			if (current && currentKind === "word" && !pendingAnsi && isClosingAnsiSequence(ansiResult.code)) {
				current += ansiResult.code;
			} else {
				pendingAnsi += ansiResult.code;
			}
			i += ansiResult.length;
			continue;
		}

		let end = text.indexOf("\x1b", i + 1);
		while (end !== -1 && ansiCodeLength(text, end) === 0) {
			end = text.indexOf("\x1b", end + 1);
		}
		if (end === -1) end = text.length;

		const chunk = text.slice(i, end);
		for (const { segment } of graphemeSegmenter.segment(chunk)) {
			const segmentIsSpace = segment === " ";
			if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
				flushCurrent();
				const token = pendingAnsi + segment;
				pendingAnsi = "";
				tokens.push(token);
				continue;
			}
			const segmentKind = segmentIsSpace ? "space" : "word";
			if (current && currentKind !== segmentKind) {
				flushCurrent();
			}
			if (pendingAnsi) {
				current += pendingAnsi;
				pendingAnsi = "";
			}
			currentKind = segmentKind;
			current += segment;
		}
		i = end;
	}

	if (pendingAnsi) {
		if (current) {
			current += pendingAnsi;
		} else if (tokens.length > 0) {
			tokens[tokens.length - 1] += pendingAnsi;
		} else {
			current = pendingAnsi;
		}
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}

function trimTrailingSpacesPreservingAnsi(line: string): string {
	if (!line) return line;
	const segments: Array<{ type: "ansi" | "text"; value: string }> = [];
	let i = 0;
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			segments.push({ type: "ansi", value: ansi.code });
			i += ansi.length;
			continue;
		}
		let end = i;
		while (end < line.length && !extractAnsiCode(line, end)) {
			end++;
		}
		segments.push({ type: "text", value: line.slice(i, end) });
		i = end;
	}

	for (let idx = segments.length - 1; idx >= 0; idx--) {
		const seg = segments[idx]!;
		if (seg.type === "ansi") continue;
		const trimmed = seg.value.replace(/ +$/, "");
		seg.value = trimmed;
		if (trimmed.length > 0) {
			break;
		}
	}

	return segments.map((s) => s.value).join("");
}

function breakLongWordPreservingOsc8(
	word: string,
	width: number,
	tracker: AnsiTracker,
	measureWidth: (s: string) => number,
): string[] {
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;
	let i = 0;
	const segments: Array<{ type: "ansi" | "grapheme"; value: string }> = [];

	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			segments.push({ type: "ansi", value: ansiResult.code });
			i += ansiResult.length;
		} else {
			let end = i;
			while (end < word.length && !extractAnsiCode(word, end)) {
				end++;
			}
			for (const seg of graphemeSegmenter.segment(word.slice(i, end))) {
				segments.push({ type: "grapheme", value: seg.segment });
			}
			i = end;
		}
	}

	for (const seg of segments) {
		if (seg.type === "ansi") {
			currentLine += seg.value;
			tracker.process(seg.value);
			continue;
		}
		const grapheme = seg.value;
		if (!grapheme) continue;
		const graphemeWidth = measureWidth(grapheme);
		if (currentWidth + graphemeWidth > width) {
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) {
				currentLine += lineEndReset;
			}
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}
		currentLine += grapheme;
		currentWidth += graphemeWidth;
	}

	if (currentLine) {
		lines.push(currentLine);
	}
	return lines.length > 0 ? lines : [""];
}

function wrapSingleLinePreservingOsc8(
	line: string,
	width: number,
	measureWidth: (s: string) => number,
): string[] {
	if (!line) return [""];
	const visibleLength = measureWidth(line);
	if (visibleLength <= width) {
		return [ensureBalancedLineOsc8(line)];
	}

	const wrapped: string[] = [];
	const tracker = new AnsiTracker();
	const tokens = splitIntoTokensWithAnsiFixed(line);
	let currentLine = "";
	let currentVisibleLength = 0;

	for (const token of tokens) {
		const tokenVisibleLength = measureWidth(token);
		const isWhitespace = stripTerminalSequencesSafe(token).trim() === "";

		if (tokenVisibleLength > width && !isWhitespace) {
			if (currentVisibleLength > 0) {
				let lineToPush = trimTrailingSpacesPreservingAnsi(currentLine);
				const lineEndReset = tracker.getLineEndReset();
				if (lineEndReset) {
					lineToPush += lineEndReset;
				}
				wrapped.push(ensureBalancedLineOsc8(lineToPush));
				currentLine = "";
				currentVisibleLength = 0;
			} else if (currentLine) {
				updateTrackerFromText(currentLine, tracker);
				currentLine = "";
			}

			const broken = breakLongWordPreservingOsc8(token, width, tracker, measureWidth);
			for (let i = 0; i < broken.length - 1; i++) {
				wrapped.push(ensureBalancedLineOsc8(broken[i]!));
			}
			currentLine = broken[broken.length - 1]!;
			currentVisibleLength = measureWidth(currentLine);
			continue;
		}

		const totalNeeded = currentVisibleLength + tokenVisibleLength;
		if (totalNeeded > width && currentVisibleLength > 0) {
			let lineToWrap = trimTrailingSpacesPreservingAnsi(currentLine);
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) {
				lineToWrap += lineEndReset;
			}
			wrapped.push(ensureBalancedLineOsc8(lineToWrap));
			if (isWhitespace) {
				updateTrackerFromText(token, tracker);
				currentLine = tracker.getActiveCodes();
				currentVisibleLength = 0;
				continue;
			}
			currentLine = tracker.getActiveCodes() + token;
			currentVisibleLength = tokenVisibleLength;
		} else {
			currentLine += token;
			currentVisibleLength += tokenVisibleLength;
		}
		updateTrackerFromText(token, tracker);
	}

	if (currentVisibleLength > 0 || wrapped.length === 0) {
		let finalLine = trimTrailingSpacesPreservingAnsi(currentLine);
		const lineEndReset = tracker.getLineEndReset();
		if (lineEndReset) {
			finalLine += lineEndReset;
		}
		wrapped.push(ensureBalancedLineOsc8(finalLine));
	}

	return wrapped.length > 0 ? wrapped : [""];
}

export function ensureBalancedLineOsc8(line: string): string {
	if (!line.includes("\x1b]8;")) return line;
	let active: ParsedOsc8 | null = null;
	let i = 0;
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			const parsed = parseOsc8Code(ansi.code);
			if (parsed !== undefined) {
				active = parsed;
			}
			i += ansi.length;
		} else {
			i++;
		}
	}
	if (active) {
		return `${line}\x1b]8;;${active.terminator}`;
	}
	return line;
}

export function wrapAnsiTextPreservingOsc8(
	text: string,
	width: number,
	measureWidth: (s: string) => number = piTui.visibleWidth,
): string[] {
	if (!text) return [""];
	const linkedText = linkifyAnsiTextUrls(text);
	const inputLines = linkedText.split(/\r\n|\r|\n/);
	const result: string[] = [];
	const tracker = new AnsiTracker();

	for (const inputLine of inputLines) {
		const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
		const wrappedLines = wrapSingleLinePreservingOsc8(prefix + inputLine, Math.max(1, width), measureWidth);
		for (const wrappedLine of wrappedLines) {
			result.push(wrappedLine);
		}
		updateTrackerFromText(inputLine, tracker);
	}

	return result.length > 0 ? result : [""];
}

export function maxLineVisibleWidth(
	text: string,
	measureWidth: (s: string) => number = piTui.visibleWidth,
): number {
	if (!text) return 0;
	if (!text.includes("\n") && !text.includes("\r")) {
		return measureWidth(text);
	}
	let max = 0;
	for (const line of text.split(/\r\n|\r|\n/)) {
		max = Math.max(max, measureWidth(line));
	}
	return max;
}

type InlineToken = {
	type: string;
	raw?: string;
	text?: string;
	href?: string;
	tokens?: InlineToken[];
	pending?: boolean;
	[key: string]: unknown;
};

let plainGfmMarked: InstanceType<typeof piTui.Marked> | undefined;
let plainGfmMarkedCtor: typeof piTui.Marked | undefined;

function getPlainGfmMarked(MarkedCtor: typeof piTui.Marked = piTui.Marked): InstanceType<typeof piTui.Marked> {
	if (!plainGfmMarked || plainGfmMarkedCtor !== MarkedCtor) {
		plainGfmMarkedCtor = MarkedCtor;
		plainGfmMarked = new MarkedCtor();
	}
	return plainGfmMarked;
}

export function expandInlineTokensForOsc8(
	tokens: InlineToken[],
	MarkedCtor: typeof piTui.Marked = piTui.Marked,
): InlineToken[] {
	if (!Array.isArray(tokens) || tokens.length === 0) return tokens;

	const expanded: InlineToken[] = [];
	for (const token of tokens) {
		// Recover links and URLs swallowed into a LaTeX token by an unclosed or non-math `$`.
		if (
			token.type === "latex" &&
			typeof token.raw === "string" &&
			token.raw.startsWith("$") &&
			!token.raw.startsWith("$$") &&
			(/https?:\/\//i.test(token.raw) ||
				token.raw.includes("\x1b]8;") ||
				HTML_BR_CONTAINS_REGEX.test(token.raw) ||
				(token.pending === true && /\[[^\]]+\]\([^)]+\)/.test(token.raw)))
		) {
			expanded.push({ type: "text", raw: "$", text: "$" });
			const rest = token.raw.slice(1);
			if (rest) {
				const relexed = getPlainGfmMarked(MarkedCtor).Lexer.lexInline(rest) as InlineToken[];
				expanded.push(...expandInlineTokensForOsc8(relexed, MarkedCtor));
			}
			continue;
		}
		expanded.push(token);
	}

	// Coalesce autolink tokens broken by `marked` at `<placeholder>` (e.g. `<redacted>`) or trailing `_`.
	const coalesced: InlineToken[] = [];
	let i = 0;
	while (i < expanded.length) {
		const current = expanded[i]!;
		if (
			current.type === "link" &&
			typeof current.href === "string" &&
			current.raw === current.href &&
			/^https?:\/\//i.test(current.href)
		) {
			let combinedUrl = current.href;
			let j = i + 1;
			let remainderToken: InlineToken | undefined;

			while (j < expanded.length) {
				const next = expanded[j]!;
				if (
					next.type === "html" &&
					typeof next.raw === "string" &&
					/^<[a-zA-Z0-9_.:-]+>$/.test(next.raw) &&
					!HTML_LAYOUT_TAG_REGEX.test(next.raw)
				) {
					combinedUrl += next.raw;
					j++;
					continue;
				}
				if (next.type === "text" && typeof next.text === "string") {
					const leadingUrlCont = /^[^\s<>"'`\x00-\x1f\x7f│┌┐└┘├┤┬┴┼─]+/.exec(next.text);
					if (leadingUrlCont) {
						const candidate = combinedUrl + leadingUrlCont[0];
						const { url: trimmedUrl, trailing } = splitTrailingUrlPunctuation(candidate);
						if (trimmedUrl.length > combinedUrl.length) {
							combinedUrl = trimmedUrl;
							const restText = trailing + next.text.slice(leadingUrlCont[0].length);
							j++;
							if (restText.length > 0) {
								remainderToken = {
									...next,
									raw: restText,
									text: restText,
								};
								break;
							}
							continue;
						}
					}
				}
				break;
			}

			if (combinedUrl !== current.href) {
				coalesced.push({
					...current,
					raw: combinedUrl,
					text: combinedUrl,
					href: combinedUrl,
					tokens: [{ type: "text", raw: combinedUrl, text: combinedUrl }],
				});
				if (remainderToken) {
					coalesced.push(remainderToken);
				}
				i = j;
				continue;
			}

			const { url: trimmedHref, trailing: hrefTrailing } = splitTrailingUrlPunctuation(current.href);
			if (trimmedHref !== current.href && trimmedHref.length > "https://".length) {
				coalesced.push({
					...current,
					raw: trimmedHref,
					text: trimmedHref,
					href: trimmedHref,
					tokens: [{ type: "text", raw: trimmedHref, text: trimmedHref }],
				});
				if (hrefTrailing.length > 0) {
					coalesced.push({
						type: "text",
						raw: hrefTrailing,
						text: hrefTrailing,
					});
				}
				i++;
				continue;
			}
		}

		coalesced.push(current);
		i++;
	}

	// Convert inline <br> HTML tokens to "br" tokens and trim adjacent horizontal spaces at line breaks.
	const normalized: InlineToken[] = [];
	let trimLeadingHorizontalSpace = false;
	for (const token of coalesced) {
		const rawHtml =
			token.type === "html" ? (typeof token.raw === "string" ? token.raw : String(token.text ?? "")) : "";
		if (token.type === "br" || (token.type === "html" && HTML_BR_TAG_REGEX.test(rawHtml.trim()))) {
			const prev = normalized[normalized.length - 1];
			if (prev && prev.type === "text" && (!prev.tokens || prev.tokens.length === 0) && typeof prev.text === "string") {
				const trimmedText = prev.text.replace(/[ \t]+$/, "");
				const trimmedRaw = typeof prev.raw === "string" ? prev.raw.replace(/[ \t]+$/, "") : trimmedText;
				if (trimmedText.length === 0 && normalized.length > 1) {
					normalized.pop();
				} else {
					normalized[normalized.length - 1] = {
						...prev,
						raw: trimmedRaw,
						text: trimmedText,
					};
				}
			}
			normalized.push({ type: "br", raw: rawHtml || token.raw || "<br>", text: "\n" });
			trimLeadingHorizontalSpace = true;
			continue;
		}

		if (
			trimLeadingHorizontalSpace &&
			token.type === "text" &&
			(!token.tokens || token.tokens.length === 0) &&
			typeof token.text === "string"
		) {
			const trimmedText = token.text.replace(/^[ \t]+/, "");
			const trimmedRaw = typeof token.raw === "string" ? token.raw.replace(/^[ \t]+/, "") : trimmedText;
			trimLeadingHorizontalSpace = false;
			if (trimmedText.length === 0) {
				continue;
			}
			normalized.push({
				...token,
				raw: trimmedRaw,
				text: trimmedText,
			});
			continue;
		}

		trimLeadingHorizontalSpace = false;
		normalized.push(token);
	}

	return normalized;
}

type PatchState = {
	installed: boolean;
	generation: number;
	origMarkdownRender: typeof piTui.Markdown.prototype.render;
	origMarkdownRenderInlineTokens: (tokens: InlineToken[], styleContext?: unknown) => string;
	origMarkdownRenderToken: (
		token: unknown,
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	) => string[];
	origMarkdownRenderTable: (
		token: any,
		availableWidth: number,
		nextTokenType?: string,
		styleContext?: any,
	) => string[];
	origMarkdownWrapCellText: (text: string, maxWidth: number, stylePrefix?: string) => string[];
	origTextRender: typeof piTui.Text.prototype.render;
	origTruncatedTextRender: typeof piTui.TruncatedText.prototype.render;
	altScreenMouseInstalled?: boolean;
	origAltScreenHandleMouseEvent?: (this: AltScreenLike, event: RawAltMouseEvent) => void;
	altScreenMouseWrapper?: (this: AltScreenLike, event: RawAltMouseEvent) => void;
	altScreenMouseImpl?: (this: AltScreenLike, event: RawAltMouseEvent) => void;
};

interface RawAltMouseEvent {
	button: number;
	x: number;
	y: number;
	release: boolean;
}

interface AltScreenSelectionPoint {
	row: number;
	col: number;
	scrollView?: unknown;
}

interface AltScreenLike {
	previousScreen?: string[];
	currentLayout?: unknown;
	terminal?: { columns: number; rows: number; write?: (data: string) => void };
	selectionAnchor?: AltScreenSelectionPoint;
	selectionFocus?: AltScreenSelectionPoint;
	selectionGranularity?: "character" | "word" | "line";
	selectionInitialRange?: unknown;
	selectionPressActive?: boolean;
	selectionDragged?: boolean;
	pressedUrl?: string;
	openUrl?: (url: string) => void;
	openFile?: (filePath: string, kind: "file" | "directory" | "path", url: string) => void;
	clearTextSelection?: () => void;
	resetTextSelection?: () => void;
	clearComponentMouseGesture?: () => void;
	flash?: (message: string, durationMs?: number) => void;
	getSelectionPoint?: (event: { x: number; y: number }, scrollView?: unknown) => AltScreenSelectionPoint;
	getSelectionSourceLine?: (point: AltScreenSelectionPoint) => string;
	requestRender?: () => void;
	_osc8PressedLink?: { url: string; x: number; y: number; movedFar: boolean };
}

const LINK_CLICK_TOLERANCE = 2;

function resolveHcPresetBinary(env: NodeJS.ProcessEnv = process.env): string {
	const home = homedir();
	const candidates: string[] = [];
	const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
	for (const dir of pathDirs) {
		candidates.push(join(dir, "hc-preset"));
	}
	candidates.push(
		join(home, "src", "dotfiles", "bin", "hc-preset"),
		join(home, ".local_dotfiles", "bin", "hc-preset"),
		join(home, ".local", "bin", "hc-preset"),
	);
	for (const candidate of candidates) {
		try {
			if (existsSync(candidate)) return candidate;
		} catch {
			// Ignore inaccessible paths.
		}
	}
	return "hc-preset";
}

function buildHerdrSpawnEnv(baseEnv: NodeJS.ProcessEnv = process.env, hcPresetPath?: string): NodeJS.ProcessEnv {
	const home = homedir();
	const extraDirs = [
		hcPresetPath && isAbsolute(hcPresetPath) ? dirname(hcPresetPath) : undefined,
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		join(home, ".local_dotfiles", "bin"),
		join(home, "src", "meta-dotfiles", "bin"),
		join(home, "src", "dotfiles", "bin"),
		join(home, ".local", "bin"),
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	].filter((d): d is string => Boolean(d));
	const existingDirs = (baseEnv.PATH ?? "").split(delimiter).filter(Boolean);
	const mergedPath = Array.from(new Set([...extraDirs, ...existingDirs])).join(delimiter);
	const activePane =
		baseEnv.HERDR_PANE_ID || baseEnv.HERDR_ACTIVE_PANE_ID || baseEnv.HC_TERMINAL_ID || undefined;
	return {
		...baseEnv,
		PATH: mergedPath,
		...(activePane ? { HERDR_ACTIVE_PANE_ID: activePane } : {}),
	};
}

export function openFileInHerdrPane(
	filePath: string,
	kind: "file" | "directory" | "path" = "file",
	fallbackUrl?: string,
): void {
	if (!filePath) return;
	const hcPreset = resolveHcPresetBinary();
	const env = buildHerdrSpawnEnv(process.env, hcPreset);
	const fallbackHref = fallbackUrl || formatHerdrFileHyperlinkUrl(filePath, kind);

	let fallbackSent = false;
	const runFallback = () => {
		if (fallbackSent) return;
		fallbackSent = true;
		const cmd = process.platform === "darwin" ? "/usr/bin/open" : "xdg-open";
		try {
			spawn(cmd, [fallbackHref], { stdio: "ignore", detached: true, cwd: "/" }).on("error", () => {}).unref();
		} catch {
			// Ignore fallback open errors.
		}
	};

	try {
		const child = spawn(hcPreset, ["open-file-with-fallback", filePath], {
			stdio: "ignore",
			detached: true,
			cwd: getSessionCwd(),
			env,
		});
		child.on("error", runFallback);
		child.on("close", (code) => {
			if (code !== 0) runFallback();
		});
		child.unref();
	} catch {
		runFallback();
	}
}

function writeHerdrOpenOsc52(screen: AltScreenLike, url: string): void {
	if (!/^https?:\/\//i.test(url)) return;
	const urlB64 = Buffer.from(url, "utf8").toString("base64");
	const record = `\x1eHERDR_OPEN_URL_V1:8f26c7a14d9346b8a01e57bc649b2e3d:${urlB64}\x1f`;
	const requestB64 = Buffer.from(record, "utf8").toString("base64");
	const osc52 = `\x1b]52;c;${requestB64}\x07`;
	if (typeof screen.terminal?.write === "function") {
		screen.terminal.write(osc52);
		return;
	}
	process.stdout.write(osc52);
}

function openLinkUrl(screen: AltScreenLike, url: string): void {
	if (!url) return;
	const inHerdrOrHc = isHerdrOrHcSession();
	if (inHerdrOrHc) {
		const fileTarget = parseFileHyperlinkUrl(url);
		if (fileTarget) {
			const herdrFileUrl = formatHerdrFileHyperlinkUrl(fileTarget.filePath, fileTarget.kind);
			if (typeof screen.openFile === "function") {
				screen.openFile(fileTarget.filePath, fileTarget.kind, herdrFileUrl);
				return;
			}
			if (typeof screen.terminal?.write === "function") {
				openFileInHerdrPane(fileTarget.filePath, fileTarget.kind, herdrFileUrl);
				return;
			}
			if (typeof screen.openUrl === "function") {
				screen.openUrl(herdrFileUrl);
				return;
			}
			openFileInHerdrPane(fileTarget.filePath, fileTarget.kind, herdrFileUrl);
			return;
		}
	}
	if (process.platform !== "darwin" && inHerdrOrHc && /^https?:\/\//i.test(url)) {
		writeHerdrOpenOsc52(screen, url);
		return;
	}
	if (
		process.platform === "darwin" &&
		inHerdrOrHc &&
		typeof screen.terminal?.write === "function" &&
		/^https?:\/\//i.test(url)
	) {
		// Inside Pi's macOS Seatbelt sandbox, `/usr/bin/open` fails with LaunchServices
		// error -54. Try `/usr/bin/open` first, and if it exits non-zero, relay the URL
		// over OSC 52 (`HERDR_OPEN_URL_V1`) to Hammerspoon (`herdrRelay.lua`).
		let fallbackSent = false;
		const sendFallback = () => {
			if (fallbackSent) return;
			fallbackSent = true;
			writeHerdrOpenOsc52(screen, url);
		};
		try {
			const child = spawn("/usr/bin/open", [url], { stdio: "ignore", detached: true, cwd: "/" });
			child.on("error", sendFallback);
			child.on("close", (code) => {
				if (code !== 0) sendFallback();
			});
			child.unref();
			return;
		} catch {
			sendFallback();
			return;
		}
	}
	if (typeof screen.openUrl === "function") {
		screen.openUrl(url);
		return;
	}
	const cmd = process.platform === "darwin" ? "open" : "xdg-open";
	spawn(cmd, [url], { stdio: "ignore", detached: true, cwd: "/" }).on("error", () => {}).unref();
}

export function getLinkAtColumn(
	line: string,
	column: number,
	tui: typeof piTui = piTui,
): string | undefined {
	if (!line || column < 0) return undefined;

	if (typeof tui.getOsc8LinkAtColumn === "function") {
		const osc8Url = tui.getOsc8LinkAtColumn(line, column);
		if (osc8Url) return rewriteUrlForHerdr(osc8Url);
	} else if (line.includes("\x1b]8;")) {
		let activeUrl: string | undefined;
		let currentCol = 0;
		let i = 0;
		while (i < line.length) {
			const ansi = extractAnsiCode(line, i);
			if (ansi) {
				const parsed = parseOsc8Code(ansi.code);
				if (parsed !== undefined) {
					activeUrl = parsed?.url || undefined;
				}
				i += ansi.length;
				continue;
			}
			let textEnd = i;
			while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
			for (const { segment } of graphemeSegmenter.segment(line.slice(i, textEnd))) {
				const width = segment === "\t" ? 3 : tui.visibleWidth(segment);
				if (column >= currentCol && column < currentCol + width) {
					if (activeUrl) return rewriteUrlForHerdr(activeUrl);
				}
				currentCol += width;
			}
			i = textEnd;
		}
	}

	const plain = stripTerminalSequencesSafe(line);
	const matches = findUrlsInPlainText(plain);
	if (matches.length === 0) return undefined;

	let currentCol = 0;
	let utf16Offset = 0;
	for (const { segment } of graphemeSegmenter.segment(plain)) {
		const width = segment === "\t" ? 3 : tui.visibleWidth(segment);
		const segStart = utf16Offset;
		const segEnd = utf16Offset + segment.length;
		if (width > 0 && column >= currentCol && column < currentCol + width) {
			for (const match of matches) {
				if (segStart < match.end && segEnd > match.start) {
					return match.url;
				}
			}
			return undefined;
		}
		currentCol += width;
		utf16Offset = segEnd;
	}
	return undefined;
}

export function resolveAltScreenUrlAt(
	screen: AltScreenLike,
	x: number,
	y: number,
	tui: typeof piTui = piTui,
): string | undefined {
	const rows = screen.terminal?.rows ?? screen.previousScreen?.length ?? 0;
	const cols = screen.terminal?.columns ?? 0;
	const clampedY = rows > 0 ? Math.max(0, Math.min(rows - 1, y)) : Math.max(0, y);
	const clampedX = cols > 0 ? Math.max(0, Math.min(cols - 1, x)) : Math.max(0, x);

	const screenLine = screen.previousScreen?.[clampedY] ?? "";
	const screenOsc8 = typeof tui.getOsc8LinkAtColumn === "function"
		? tui.getOsc8LinkAtColumn(screenLine, clampedX)
		: undefined;
	if (screenOsc8) return rewriteUrlForHerdr(screenOsc8);

	let sourceUrl: string | undefined;
	if (typeof screen.getSelectionPoint === "function" && typeof screen.getSelectionSourceLine === "function") {
		try {
			const point = screen.getSelectionPoint({ x: clampedX, y: clampedY }, screen.selectionAnchor?.scrollView);
			if (point) {
				const sourceLine = screen.getSelectionSourceLine(point);
				if (sourceLine) {
					sourceUrl = getLinkAtColumn(sourceLine, point.col, tui);
				}
			}
		} catch {
			// Fall back to screen line inspection.
		}
	}

	const screenPlainUrl = getLinkAtColumn(screenLine, clampedX, tui);
	if (sourceUrl && screenPlainUrl) {
		return sourceUrl.length >= screenPlainUrl.length ? sourceUrl : screenPlainUrl;
	}
	return screenPlainUrl ?? sourceUrl;
}

export function enableOsc8Hyperlinks(tui: typeof piTui = piTui): void {
	const current = tui.getCapabilities();
	if (!current.hyperlinks) {
		tui.setCapabilityOverrides({
			hyperlinks: true,
		});
	}
}

export function installOsc8LinkRendering(tui: typeof piTui = piTui): void {
	enableOsc8Hyperlinks(tui);

	const globalHolder = globalThis as Record<symbol, PatchState | undefined>;
	const existing = globalHolder[PATCH_STATE_SYMBOL];

	const mdProto = tui.Markdown.prototype as unknown as {
		render: (width: number) => string[];
		renderInlineTokens: (tokens: InlineToken[], styleContext?: any) => string;
		renderToken: (token: any, width: number, nextTokenType?: string, styleContext?: any) => string[];
		renderTable: (token: any, availableWidth: number, nextTokenType?: string, styleContext?: any) => string[];
		getLongestWordWidth: (text: string, maxWidth?: number) => number;
		wrapCellText: (text: string, maxWidth: number, stylePrefix?: string) => string[];
		getDefaultInlineStyleContext: () => { applyText: (t: string) => string; stylePrefix: string };
		getStylePrefix: (styleFn: (t: string) => string) => string;
		theme: {
			link: (t: string) => string;
			linkUrl: (t: string) => string;
			code: (t: string) => string;
			underline: (t: string) => string;
			bold: (t: string) => string;
			italic: (t: string) => string;
			strikethrough: (t: string) => string;
		};
		options: {
			preserveBackslashEscapes?: boolean;
			renderLatex?: boolean;
			transform?: (text: string, width: number) => string;
		};
		text: string;
	};

	const state: PatchState = existing ?? {
		installed: true,
		generation: 0,
		origMarkdownRender: mdProto.render,
		origMarkdownRenderInlineTokens: mdProto.renderInlineTokens,
		origMarkdownRenderToken: mdProto.renderToken,
		origMarkdownRenderTable: mdProto.renderTable,
		origMarkdownWrapCellText: mdProto.wrapCellText,
		origTextRender: tui.Text.prototype.render,
		origTruncatedTextRender: tui.TruncatedText.prototype.render,
	};
	state.generation += 1;
	globalHolder[PATCH_STATE_SYMBOL] = state;

	mdProto.render = function (this: typeof mdProto, width: number): string[] {
		enableOsc8Hyperlinks(tui);
		const cacheHolder = this as unknown as {
			cachedLines?: string[];
			cachedTokens?: unknown;
			_osc8Gen?: number;
		};
		if (cacheHolder._osc8Gen !== state.generation) {
			cacheHolder.cachedLines = undefined;
			cacheHolder.cachedTokens = undefined;
			cacheHolder._osc8Gen = state.generation;
		}
		const origTransform = this.options.transform;
		this.options.transform = (text: string, contentWidth: number) => {
			const transformed = origTransform ? origTransform(text, contentWidth) : text;
			return normalizeMarkdownForOsc8(transformed);
		};
		try {
			return state.origMarkdownRender.call(this as unknown as piTui.Markdown, width);
		} finally {
			this.options.transform = origTransform;
		}
	};

	mdProto.renderInlineTokens = function (
		this: typeof mdProto,
		rawTokens: InlineToken[],
		styleContext?: { applyText: (t: string) => string; stylePrefix: string; inLink?: boolean },
	): string {
		enableOsc8Hyperlinks(tui);
		const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
		const { applyText, stylePrefix } = resolvedStyleContext;
		const inLink = Boolean((resolvedStyleContext as { inLink?: boolean }).inLink);
		const tokens = expandInlineTokensForOsc8(rawTokens, tui.Marked);

		const stylePlainUrl = (urlText: string, url: string) => {
			if (isFileHyperlinkUrl(url)) {
				return tui.hyperlink(applyText(urlText), url) + stylePrefix;
			}
			const styled = this.theme.link(this.theme.underline(applyText(urlText)));
			return tui.hyperlink(styled, url) + stylePrefix;
		};

		const applyTextWithNewlinesAndUrls = (text: string) => {
			return text
				.split("\n")
				.map((segment) =>
					inLink ? applyText(segment) : linkifyPlainTextUrls(segment, stylePlainUrl, (chunk) => applyText(chunk)),
				)
				.join("\n");
		};

		let result = "";
		for (const token of tokens) {
			switch (token.type) {
				case "codespan": {
					const codeText = String(token.text ?? "");
					if (inLink) {
						result += this.theme.code(codeText) + stylePrefix;
					} else {
						result +=
							linkifyPlainTextUrls(
								codeText,
								(urlText, url) => {
									const styled = isFileHyperlinkUrl(url)
										? this.theme.code(urlText)
										: this.theme.link(this.theme.underline(urlText));
									return tui.hyperlink(styled, url);
								},
								(chunk) => this.theme.code(chunk),
							) + stylePrefix;
					}
					break;
				}
				case "link": {
					const rawHref = String(token.href ?? "");
					const href = resolveMarkdownLinkHref(rawHref);
					const linkStyleFn = (text: string) => this.theme.link(this.theme.underline(text));
					const linkStylePrefix = this.getStylePrefix(linkStyleFn);
					const childContext = {
						applyText: (t: string) => t,
						stylePrefix: linkStylePrefix,
						inLink: true,
					};
					const innerText =
						token.tokens && token.tokens.length > 0
							? this.renderInlineTokens(token.tokens, childContext)
							: String(token.text ?? rawHref);
					const styledLink = linkStyleFn(innerText || rawHref);
					result += tui.hyperlink(styledLink, href) + stylePrefix;
					break;
				}
				case "text": {
					if (token.tokens && token.tokens.length > 0) {
						result += this.renderInlineTokens(token.tokens, resolvedStyleContext);
					} else {
						result += applyTextWithNewlinesAndUrls(String(token.text ?? ""));
					}
					break;
				}
				case "escape": {
					const escapeText = this.options.preserveBackslashEscapes
						? String(token.raw ?? "")
						: String(token.text ?? "");
					result += applyTextWithNewlinesAndUrls(escapeText);
					break;
				}
				case "br": {
					result = `${trimTrailingSpacesPreservingAnsi(result)}\n`;
					break;
				}
				case "html": {
					const rawHtml = typeof token.raw === "string" ? token.raw : String(token.text ?? "");
					if (HTML_BR_TAG_REGEX.test(rawHtml.trim())) {
						result = `${trimTrailingSpacesPreservingAnsi(result)}\n`;
						break;
					}
					const anchorMatch = HTML_ANCHOR_REGEX.exec(rawHtml.trim());
					if (!inLink && anchorMatch) {
						const rawHref = (anchorMatch[1] ?? anchorMatch[2] ?? anchorMatch[3] ?? "").trim();
						const href = resolveMarkdownLinkHref(rawHref);
						const label =
							stripTerminalSequencesSafe((anchorMatch[4] ?? "").replace(/<\/?br\s*\/?>/gi, "\n")).trim() || rawHref;
						result += stylePlainUrl(label, href);
					} else {
						result += applyTextWithNewlinesAndUrls(rawHtml);
					}
					break;
				}
				case "strong": {
					const boldPrefix = this.getStylePrefix((t) => this.theme.bold(t));
					const boldContent = this.renderInlineTokens(token.tokens || [], {
						applyText,
						stylePrefix: stylePrefix + boldPrefix,
						inLink,
					});
					result += this.theme.bold(boldContent) + stylePrefix;
					break;
				}
				case "em": {
					const italicPrefix = this.getStylePrefix((t) => this.theme.italic(t));
					const italicContent = this.renderInlineTokens(token.tokens || [], {
						applyText,
						stylePrefix: stylePrefix + italicPrefix,
						inLink,
					});
					result += this.theme.italic(italicContent) + stylePrefix;
					break;
				}
				case "del": {
					const delPrefix = this.getStylePrefix((t) => this.theme.strikethrough(t));
					const delContent = this.renderInlineTokens(token.tokens || [], {
						applyText,
						stylePrefix: stylePrefix + delPrefix,
						inLink,
					});
					result += this.theme.strikethrough(delContent) + stylePrefix;
					break;
				}
				default: {
					const chunk = state.origMarkdownRenderInlineTokens.call(this, [token], resolvedStyleContext);
					result += inLink ? chunk : linkifyAnsiTextUrls(chunk);
					break;
				}
			}
		}

		while (stylePrefix && result.endsWith(stylePrefix)) {
			result = result.slice(0, -stylePrefix.length);
		}
		return result;
	};

	mdProto.renderToken = function (
		this: typeof mdProto,
		token: any,
		width: number,
		nextTokenType?: string,
		styleContext?: any,
	): string[] {
		const lines = state.origMarkdownRenderToken.call(this, token, width, nextTokenType, styleContext);
		const linkedLines = lines.map((line) => linkifyAnsiLineUrls(line));
		const tokenType = token?.type;
		if (
			tokenType === "table" ||
			tokenType === "list" ||
			tokenType === "blockquote" ||
			tokenType === "hr" ||
			tokenType === "space"
		) {
			return linkedLines;
		}
		const targetWidth = Math.max(1, width);
		const wrapped: string[] = [];
		for (const line of linkedLines) {
			if (!line) {
				wrapped.push("");
			} else {
				wrapped.push(...wrapAnsiTextPreservingOsc8(line, targetWidth, tui.visibleWidth));
			}
		}
		return wrapped;
	};

	mdProto.renderTable = function (
		this: typeof mdProto,
		token: any,
		availableWidth: number,
		nextTokenType?: string,
		styleContext?: any,
	): string[] {
		const lines: string[] = [];
		const numCols = token.header?.length ?? 0;
		if (numCols === 0) {
			return lines;
		}
		const borderOverhead = 3 * numCols + 1;
		const availableForCells = availableWidth - borderOverhead;
		if (availableForCells < numCols) {
			const fallbackRaw = typeof token.raw === "string" ? token.raw.replace(/<\/?br\s*\/?>/gi, "\n") : "";
			const fallbackLines = fallbackRaw ? wrapAnsiTextPreservingOsc8(fallbackRaw, availableWidth, tui.visibleWidth) : [];
			if (nextTokenType && nextTokenType !== "space") {
				fallbackLines.push("");
			}
			return fallbackLines;
		}

		const maxUnbrokenWordWidth = 30;
		const naturalWidths: number[] = [];
		const minWordWidths: number[] = [];
		const headerTexts: string[] = [];
		const rowTexts: string[][] = [];

		for (let i = 0; i < numCols; i++) {
			const headerText = this.renderInlineTokens(token.header[i].tokens || [], styleContext);
			headerTexts[i] = headerText;
			naturalWidths[i] = maxLineVisibleWidth(headerText, tui.visibleWidth);
			minWordWidths[i] = Math.max(1, this.getLongestWordWidth(headerText, maxUnbrokenWordWidth));
		}

		for (const row of token.rows) {
			const renderedRow: string[] = [];
			for (let i = 0; i < row.length; i++) {
				const cellText = this.renderInlineTokens(row[i].tokens || [], styleContext);
				renderedRow[i] = cellText;
				naturalWidths[i] = Math.max(naturalWidths[i] || 0, maxLineVisibleWidth(cellText, tui.visibleWidth));
				minWordWidths[i] = Math.max(minWordWidths[i] || 1, this.getLongestWordWidth(cellText, maxUnbrokenWordWidth));
			}
			rowTexts.push(renderedRow);
		}

		let minColumnWidths = minWordWidths.slice();
		let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
		if (minCellsWidth > availableForCells) {
			minColumnWidths = new Array(numCols).fill(1);
			const remaining = availableForCells - numCols;
			if (remaining > 0) {
				const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
				const growth = minWordWidths.map((width) => {
					const weight = Math.max(0, width - 1);
					return totalWeight > 0 ? Math.floor((weight / totalWeight) * remaining) : 0;
				});
				for (let i = 0; i < numCols; i++) {
					minColumnWidths[i] += growth[i] ?? 0;
				}
				const allocated = growth.reduce((total, width) => total + width, 0);
				let leftover = remaining - allocated;
				for (let i = 0; leftover > 0 && i < numCols; i++) {
					minColumnWidths[i]++;
					leftover--;
				}
			}
			minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
		}

		const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
		let columnWidths: number[];
		if (totalNaturalWidth <= availableWidth) {
			columnWidths = naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]!));
		} else {
			const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
				return total + Math.max(0, width - minColumnWidths[index]!);
			}, 0);
			const extraWidth = Math.max(0, availableForCells - minCellsWidth);
			columnWidths = minColumnWidths.map((minWidth, index) => {
				const naturalWidth = naturalWidths[index]!;
				const minWidthDelta = Math.max(0, naturalWidth - minWidth);
				let grow = 0;
				if (totalGrowPotential > 0) {
					grow = Math.floor((minWidthDelta / totalGrowPotential) * extraWidth);
				}
				return minWidth + grow;
			});
			const allocated = columnWidths.reduce((a, b) => a + b, 0);
			let remaining = availableForCells - allocated;
			while (remaining > 0) {
				let grew = false;
				for (let i = 0; i < numCols && remaining > 0; i++) {
					if (columnWidths[i]! < naturalWidths[i]!) {
						columnWidths[i]!++;
						remaining--;
						grew = true;
					}
				}
				if (!grew) {
					break;
				}
			}
		}

		const topBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`┌─${topBorderCells.join("─┬─")}─┐`);

		const headerCellLines = headerTexts.map((text, i) =>
			this.wrapCellText(text, columnWidths[i]!, styleContext?.stylePrefix),
		);
		const headerLineCount = Math.max(...headerCellLines.map((c) => c.length));
		for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
			const rowParts = headerCellLines.map((cellLines, colIdx) => {
				const text = cellLines[lineIdx] || "";
				const padded = text + " ".repeat(Math.max(0, columnWidths[colIdx]! - tui.visibleWidth(text)));
				return this.theme.bold(padded);
			});
			lines.push(`│ ${rowParts.join(" │ ")} │`);
		}

		const separatorCells = columnWidths.map((w) => "─".repeat(w));
		const separatorLine = `├─${separatorCells.join("─┼─")}─┤`;
		lines.push(separatorLine);

		for (let rowIndex = 0; rowIndex < rowTexts.length; rowIndex++) {
			const row = rowTexts[rowIndex]!;
			const rowCellLines = row.map((text, i) =>
				this.wrapCellText(text, columnWidths[i]!, styleContext?.stylePrefix),
			);
			const rowLineCount = Math.max(...rowCellLines.map((c) => c.length));
			for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
				const rowParts = rowCellLines.map((cellLines, colIdx) => {
					const text = cellLines[lineIdx] || "";
					return text + " ".repeat(Math.max(0, columnWidths[colIdx]! - tui.visibleWidth(text)));
				});
				lines.push(`│ ${rowParts.join(" │ ")} │`);
			}
			if (rowIndex < rowTexts.length - 1) {
				lines.push(separatorLine);
			}
		}

		const bottomBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`└─${bottomBorderCells.join("─┴─")}─┘`);
		if (nextTokenType && nextTokenType !== "space") {
			lines.push("");
		}
		return lines;
	};

	mdProto.wrapCellText = function (
		this: typeof mdProto,
		text: string,
		maxWidth: number,
		stylePrefix = "",
	): string[] {
		const lines = wrapAnsiTextPreservingOsc8(text, Math.max(1, maxWidth), tui.visibleWidth);
		return lines.map((line, index) => {
			const styleReset = index < lines.length - 1 ? "\x1b[22;23;24;25;27;28;29;39m" : "";
			return `${line}${styleReset}${stylePrefix}`;
		});
	};

	tui.Text.prototype.render = function (this: piTui.Text, width: number): string[] {
		enableOsc8Hyperlinks(tui);
		const textHolder = this as unknown as {
			text: string;
			paddingX?: number;
			cachedText?: string;
			cachedWidth?: number;
			cachedLines?: string[];
			_osc8Gen?: number;
		};
		if (textHolder._osc8Gen !== state.generation) {
			textHolder.cachedLines = undefined;
			textHolder._osc8Gen = state.generation;
		}
		const rawText = textHolder.text;
		if (!rawText || rawText.trim() === "") {
			return state.origTextRender.call(this, width);
		}
		if (textHolder.cachedLines && textHolder.cachedText === rawText && textHolder.cachedWidth === width) {
			return textHolder.cachedLines;
		}
		const normalizedText = rawText.replace(/\t/g, "   ");
		const paddingX = Math.min(textHolder.paddingX ?? 0, Math.max(0, Math.floor((width - 1) / 2)));
		const contentWidth = Math.max(1, width - paddingX * 2);
		const prewrappedText = wrapAnsiTextPreservingOsc8(normalizedText, contentWidth, tui.visibleWidth).join("\n");
		textHolder.text = prewrappedText;
		try {
			const lines = state.origTextRender.call(this, width);
			textHolder.cachedText = rawText;
			return lines;
		} finally {
			textHolder.text = rawText;
		}
	};

	tui.TruncatedText.prototype.render = function (this: piTui.TruncatedText, width: number): string[] {
		enableOsc8Hyperlinks(tui);
		const textHolder = this as unknown as { text: string };
		const rawText = textHolder.text;
		if (!rawText) {
			return state.origTruncatedTextRender.call(this, width);
		}
		textHolder.text = linkifyAnsiTextUrls(rawText);
		try {
			return state.origTruncatedTextRender.call(this, width);
		} finally {
			textHolder.text = rawText;
		}
	};

	const altProto = (tui as unknown as { TuiAltScreen?: { prototype?: Record<string, unknown> } }).TuiAltScreen
		?.prototype as
		| {
				handleMouseEvent?: (this: AltScreenLike, event: RawAltMouseEvent) => void;
		  }
		| undefined;

	if (altProto && typeof altProto.handleMouseEvent === "function") {
		if (!state.altScreenMouseInstalled || !state.origAltScreenHandleMouseEvent || !state.altScreenMouseWrapper) {
			state.origAltScreenHandleMouseEvent = altProto.handleMouseEvent;
			state.altScreenMouseWrapper = function (this: AltScreenLike, raw: RawAltMouseEvent): void {
				return state.altScreenMouseImpl!.call(this, raw);
			};
			altProto.handleMouseEvent = state.altScreenMouseWrapper;
			state.altScreenMouseInstalled = true;
		}

		let inMouseImpl = false;
		state.altScreenMouseImpl = function (this: AltScreenLike, raw: RawAltMouseEvent): void {
			const origHandleMouseEvent = state.origAltScreenHandleMouseEvent!;
			if (!raw || inMouseImpl) {
				return origHandleMouseEvent.call(this, raw);
			}
			const isMotion = (raw.button & 32) !== 0;
			const buttonCode = raw.button & 3;
			const isPrimaryPress = !raw.release && !isMotion && buttonCode === 0;
			const isPrimaryRelease = raw.release && (buttonCode === 0 || buttonCode === 3);

			if (isPrimaryPress) {
				const url = resolveAltScreenUrlAt(this, raw.x, raw.y, tui);
				this._osc8PressedLink = url ? { url, x: raw.x, y: raw.y, movedFar: false } : undefined;
				inMouseImpl = true;
				try {
					origHandleMouseEvent.call(this, raw);
				} finally {
					inMouseImpl = false;
				}
				if (url) {
					this.pressedUrl = url;
					// Prevent double/triple clicks on a link from selecting the word instead of opening the link.
					if (this.selectionGranularity && this.selectionGranularity !== "character") {
						this.selectionGranularity = "character";
						this.selectionInitialRange = undefined;
						if (typeof this.getSelectionPoint === "function") {
							const pt = this.getSelectionPoint({ x: raw.x, y: raw.y }, this.selectionAnchor?.scrollView);
							this.selectionAnchor = pt;
							this.selectionFocus = pt;
						} else if (this.selectionAnchor) {
							this.selectionFocus = { ...this.selectionAnchor };
						}
					}
				}
				return;
			}

			if (isMotion && this._osc8PressedLink) {
				const pending = this._osc8PressedLink;
				if (raw.x === pending.x && raw.y === pending.y) {
					// Ignore sub-cell motion events on the exact press cell so TuiAltScreen
					// does not clear pressedUrl or mark the click as a drag selection.
					return;
				}
				const withinTolerance =
					raw.y === pending.y && Math.abs(raw.x - pending.x) <= LINK_CLICK_TOLERANCE;
				if (withinTolerance && resolveAltScreenUrlAt(this, raw.x, raw.y, tui) === pending.url) {
					// Ignore 1-2 cell pointer jitter along the same link during a click.
					return;
				}
				pending.movedFar = true;
				this._osc8PressedLink = undefined;
			}

			if (isPrimaryRelease && this._osc8PressedLink) {
				const pending = this._osc8PressedLink;
				this._osc8PressedLink = undefined;
				const withinTolerance =
					!pending.movedFar &&
					raw.y === pending.y &&
					Math.abs(raw.x - pending.x) <= LINK_CLICK_TOLERANCE;
				const releaseUrl = withinTolerance ? resolveAltScreenUrlAt(this, raw.x, raw.y, tui) : undefined;
				if (withinTolerance && (raw.x === pending.x || releaseUrl === pending.url)) {
					this.clearTextSelection?.();
					this.resetTextSelection?.();
					this.clearComponentMouseGesture?.();
					this.selectionPressActive = false;
					this.selectionDragged = false;
					this.selectionAnchor = undefined;
					this.selectionFocus = undefined;
					this.pressedUrl = undefined;
					try {
						openLinkUrl(this, pending.url);
						this.flash?.("Opening link…");
					} catch {
						// Ignore openUrl errors.
					}
					this.requestRender?.();
					return;
				}
			}

			inMouseImpl = true;
			try {
				return origHandleMouseEvent.call(this, raw);
			} finally {
				inMouseImpl = false;
			}
		};
	}
}

function extractAndRegisterToolPaths(payload: unknown, cwd?: string): void {
	if (!payload || typeof payload !== "object") return;
	const obj = payload as Record<string, unknown>;
	const candidates = [obj.input, obj.args, obj.arguments, obj];
	for (const item of candidates) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, unknown>;
		for (const key of ["path", "file_path", "scriptPath"]) {
			if (typeof rec[key] === "string") {
				registerKnownFilePath(rec[key] as string, cwd);
			}
		}
	}
}

function indexSessionEntries(entries: unknown, cwd?: string): void {
	if (!Array.isArray(entries)) return;
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		extractAndRegisterToolPaths(rec, cwd);
		const msg = rec.message as Record<string, unknown> | undefined;
		if (!msg || typeof msg !== "object") continue;
		const content = msg.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const b = block as Record<string, unknown>;
			if (b.type === "toolCall") {
				extractAndRegisterToolPaths(b, cwd);
			}
		}
	}
}

function indexSessionFileIfNeeded(sessionFile: string | undefined, cwd?: string): void {
	if (!sessionFile) return;
	const state = getSharedPathState();
	if (state.indexedSessionFiles.has(sessionFile)) return;
	state.indexedSessionFiles.add(sessionFile);
	try {
		if (!existsSync(sessionFile)) return;
		const raw = readFileSync(sessionFile, "utf8");
		const parsedEntries: unknown[] = [];
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			try {
				parsedEntries.push(JSON.parse(line));
			} catch {
				// Ignore malformed JSONL lines.
			}
		}
		indexSessionEntries(parsedEntries, cwd);
	} catch {
		// Ignore unreadable session files.
	}
}

export default function osc8LinksExtension(pi: ExtensionAPI): void {
	installOsc8LinkRendering(piTui);
	if (process.env.PI_SESSION_FILE) {
		indexSessionFileIfNeeded(process.env.PI_SESSION_FILE);
	}
	pi.registerMarkdownTransformer((markdown) => normalizeMarkdownForOsc8(markdown));
	pi.on("session_start", (_event, ctx) => {
		if (ctx?.cwd) setSessionCwd(ctx.cwd);
		const sm = (ctx as unknown as {
			sessionManager?: {
				getEntries?: () => unknown[];
				getSessionFile?: () => string | undefined;
			};
		})?.sessionManager;
		if (typeof sm?.getEntries === "function") {
			indexSessionEntries(sm.getEntries(), ctx?.cwd);
		}
		if (typeof sm?.getSessionFile === "function") {
			indexSessionFileIfNeeded(sm.getSessionFile(), ctx?.cwd);
		}
		installOsc8LinkRendering(piTui);
	});
	pi.on("tool_call", (event, ctx) => {
		if (ctx?.cwd) setSessionCwd(ctx.cwd);
		extractAndRegisterToolPaths(event, ctx?.cwd);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx?.cwd) setSessionCwd(ctx.cwd);
		extractAndRegisterToolPaths(event, ctx?.cwd);
	});
}
