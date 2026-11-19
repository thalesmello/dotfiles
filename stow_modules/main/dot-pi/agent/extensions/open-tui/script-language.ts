/** Pure, deliberately small shell-preview inference. Nothing is executed or decoded as code. */
export type ScriptSegment = { source: string; language: string };

const extensions: Record<string, string> = {
	py: "python", pyw: "python", pyi: "python", rb: "ruby", rake: "ruby", gemspec: "ruby",
	rs: "rust", c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp",
	java: "java", php: "php", phtml: "php", js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
	ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescript", r: "r", sql: "sql", go: "go",
	sh: "bash", bash: "bash", zsh: "bash", ksh: "bash", fish: "bash", ps1: "powershell", bat: "dos", cmd: "dos",
	json: "json", jsonc: "json", yaml: "yaml", yml: "yaml",
	html: "xml", htm: "xml", xml: "xml", svg: "xml", css: "css", scss: "scss", less: "less",
	lua: "lua", pl: "perl", pm: "perl", swift: "swift", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala",
	cs: "csharp", csx: "csharp", dart: "dart", toml: "toml", md: "markdown", markdown: "markdown",
};

export function languageForPath(path: string): string | undefined {
	const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
	const lower = name.toLowerCase();
	if (/^\.(?:bashrc|bash_profile|bash_login|profile|zshrc|zprofile)$/.test(lower)) return "bash";
	if (["gemfile", "rakefile"].includes(lower)) return "ruby";
	if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
	if (lower === "makefile" || lower === "gnumakefile") return "makefile";
	const dot = lower.lastIndexOf(".");
	const extension = lower.slice(dot + 1);
	return dot >= 0 && Object.prototype.hasOwnProperty.call(extensions, extension) ? extensions[extension] : undefined;
}

type Quote = { start: number; end: number; safe: boolean };
type Token = { kind: "word" | "op"; start: number; end: number; value?: string; quotes: Quote[] };
type Range = { start: number; end: number; language: string };
type Heredoc = { delimiter: string; tabs: boolean; language?: string };
const separators = new Set([";", "&&", "||", "|", "&"]);
const redirects = new Set(["<", ">", ">>", ">|", "<>", "<&", ">&", "<<", "<<-", "<<<"]);

// Read one logical header, not heredoc bodies. Unsupported substitutions/grouping bail out.
function shellLine(source: string, start: number): { tokens: Token[]; end: number } | undefined {
	const tokens: Token[] = [];
	let i = start;
	while (i < source.length) {
		if (source.startsWith("\\\n", i)) { i += 2; continue; }
		if (source[i] === "\n") return { tokens, end: i + 1 };
		if (/[ \t\r]/.test(source[i]!)) { i++; continue; }
		if (source[i] === "#") {
			const newline = source.indexOf("\n", i);
			return { tokens, end: newline < 0 ? source.length : newline + 1 };
		}
		if (/[()\x60]/.test(source[i]!) || source.startsWith("$(", i)) return undefined;
		const operator = /^(?:<<<|<<-|<<|>>|&&|\|\||[<>][&|]?|[;|&])/.exec(source.slice(i));
		if (operator) {
			tokens.push({ kind: "op", start: i, end: i + operator[0].length, value: operator[0], quotes: [] });
			i += operator[0].length;
			continue;
		}
		const wordStart = i;
		const quotes: Quote[] = [];
		let value = "", safe = true;
		while (i < source.length && !/[ \t\r\n;|&<>]/.test(source[i]!)) {
			const char = source[i]!;
			if (/[()\x60]/.test(char) || source.startsWith("$(", i)) return undefined;
			if (char === "\\") {
				if (++i === source.length) return undefined;
				if (source[i] !== "\n") value += source[i];
				i++;
			} else if (char === "'" || char === '"') {
				const quoteStart = i++;
				let quoteSafe = true;
				while (i < source.length && source[i] !== char) {
					if (char === '"' && (source[i] === "$" || source[i] === "\x60")) quoteSafe = false;
					if (char === '"' && source[i] === "\\" && /[\x60$"\\\n]/.test(source[i + 1] ?? "")) {
						i++;
						if (source[i] !== "\n") value += source[i];
						i++;
					} else value += source[i++];
				}
				if (i === source.length) return undefined;
				i++;
				quotes.push({ start: quoteStart, end: i, safe: quoteSafe });
				safe &&= quoteSafe;
			} else {
				if (char === "$" || char === "*" || char === "?" || char === "[" || char === "{" || char === "}") safe = false;
				value += char;
				i++;
			}
		}
		tokens.push({ kind: "word", start: wordStart, end: i, value: safe ? value : undefined, quotes });
	}
	return { tokens, end: i };
}

function executableLanguage(executable: string): string | undefined {
	const name = executable.replace(/\\/g, "/").split("/").pop()!.replace(/\.exe$/i, "");
	if (/^python(?:\d+(?:\.\d+)*)?$/.test(name)) return "python";
	if (/^ruby(?:\d+(?:\.\d+)*)?$/.test(name)) return "ruby";
	if (/^perl(?:\d+(?:\.\d+)*)?$/.test(name)) return "perl";
	if (/^lua(?:\d+(?:\.\d+)*)?$/.test(name) || name === "luajit") return "lua";
	const names: Record<string, string> = {
		rustc: "rust", go: "go", gcc: "c", cc: "c", clang: "c", "g++": "cpp", "c++": "cpp", "clang++": "cpp",
		java: "java", jshell: "java", php: "php", node: "javascript", nodejs: "javascript", deno: "javascript", bun: "javascript",
		"ts-node": "typescript", tsx: "typescript", R: "r", Rscript: "r", sqlite3: "sql", psql: "sql", mysql: "sql",
		swift: "swift", kotlin: "kotlin", scala: "scala", dart: "dart", csi: "csharp",
	};
	return Object.prototype.hasOwnProperty.call(names, name) ? names[name] : undefined;
}

function inlineFlags(language: string, executable: string): string[] {
	if (language === "python") return ["-c"];
	if (language === "php") return ["-r"];
	if (language === "sql") return executable === "psql" ? ["-c", "--command"]
		: executable === "mysql" ? ["-e", "--execute"] : ["-cmd"];
	if (language === "javascript" || language === "typescript") return ["-e", "--eval", "-p", "--print"];
	if (language === "perl") return ["-e", "-E"];
	if (["ruby", "lua", "r", "swift", "kotlin", "scala"].includes(language)) return ["-e"];
	return [];
}

function quotedRange(token: Token, prefix: string, language: string): Range | undefined {
	const quote = token.quotes[0];
	if (token.quotes.length !== 1 || !quote?.safe || quote.start !== token.start + prefix.length || quote.end !== token.end) return undefined;
	return { start: quote.start + 1, end: quote.end - 1, language };
}

// Known switches with values: do not mistake their argument for a script filename or code switch.
const optionValues = new Set(["-W", "-X", "-I", "-r", "--require", "--import", "--loader", "-U", "-d", "-h", "-p", "--host", "--port", "--dbname", "--user", "-x", "-o", "--edition", "-cp", "--class-path"]);

function commandInfo(words: Token[], source: string, ranges: Range[]): { language?: string; stdin: boolean } {
	let i = 0;
	const assignment = (token: Token | undefined) => token && /^[A-Za-z_]\w*=/.test(source.slice(token.start, token.end));
	while (assignment(words[i])) i++;
	if (words[i]?.value === "env") {
		i++;
		if (words[i]?.value === "--") i++;
		while (assignment(words[i])) i++;
	}
	if (words[i]?.value === "command" || words[i]?.value === "exec") i++;
	const executable = words[i++]?.value;
	if (!executable) return { stdin: false };
	const name = executable.split("/").pop()!;
	const language = executableLanguage(executable);
	if (!language) return { stdin: false };
	const flags = inlineFlags(language, name);
	let stdin = true;
	for (; i < words.length; i++) {
		const token = words[i]!;
		const raw = source.slice(token.start, token.end);
		const flag = flags.find((flag) => token.value === flag || raw.startsWith(flag.startsWith("--") ? flag + "=" : flag));
		if (flag) {
			stdin = false; // An inline program's stdin is data, not more source.
			if (token.value === flag) {
				const argument = words[++i];
				if (!argument) break;
				const range = quotedRange(argument, "", language);
				if (range) ranges.push(range);
			} else {
				const prefix = flag + (flag.startsWith("--") ? "=" : "");
				const range = quotedRange(token, prefix, language);
				if (range) ranges.push(range);
			}
			// Python, for example, treats every word after -c CODE as program arguments.
			if (!["ruby", "perl", "r"].includes(language)) break;
			continue;
		}
		if (name === "deno" && token.value === "eval") {
			const argument = words[++i];
			const range = argument && quotedRange(argument, "", language);
			if (range) ranges.push(range);
			stdin = false;
			break;
		}
		if (token.value === "-m" || token.value === "--") { stdin = false; break; }
		if (token.value && optionValues.has(token.value)) { i++; continue; }
		if (token.value === "-" || token.value === "/dev/stdin" || token.value === "/proc/self/fd/0") continue;
		if ((name === "go" || name === "deno" || name === "bun") && token.value === "run") continue;
		if (token.value?.startsWith("-")) continue;
		// A script path (or an unknown/dynamic positional argument) means stdin is data.
		if (language !== "sql") { stdin = false; break; }
	}
	return { language, stdin };
}

function analyzeHeader(tokens: Token[], source: string, ranges: Range[]): Heredoc[] | undefined {
	const pending: Heredoc[] = [];
	let start = 0;
	for (let end = 0; end <= tokens.length; end++) {
		if (end < tokens.length && !(tokens[end]!.kind === "op" && separators.has(tokens[end]!.value!))) continue;
		const words: Token[] = [];
		const documents: Heredoc[] = [];
		const paths: string[] = [];
		for (let i = start; i < end; i++) {
			const token = tokens[i]!;
			if (token.kind === "op") {
				if (!redirects.has(token.value!)) return undefined;
				const operand = tokens[++i];
				if (!operand || i >= end || operand.kind !== "word") return undefined;
				if (token.value === "<<" || token.value === "<<-") {
					if (!operand.value || !/^[\w-]+$/.test(operand.value)) return undefined;
					documents.push({ delimiter: operand.value, tabs: token.value === "<<-" });
				} else if ([">", ">>", ">|"].includes(token.value!) && operand.value) {
					const language = languageForPath(operand.value);
					if (language) paths.push(language);
				}
			} else if (!(token.value && /^\d+$/.test(token.value) && tokens[i + 1]?.kind === "op" && token.end === tokens[i + 1]!.start && redirects.has(tokens[i + 1]!.value!))) {
				words.push(token);
			}
		}
		const info = commandInfo(words, source, ranges);
		// Multiple input redirections on one command are ambiguous; don't guess which is code.
		if (documents.length === 1) {
			documents[0]!.language = info.language ? (info.stdin ? info.language : undefined)
				: paths.length === 1 ? paths[0] : undefined;
		}
		pending.push(...documents);
		start = end + 1;
	}
	return pending;
}

/** Split shell and confidently identified embedded source; slices always preserve the input exactly. */
export function scriptSegments(command: string): ScriptSegment[] {
	const fallback = () => [{ source: command, language: "bash" }];
	const ranges: Range[] = [];
	let offset = 0;
	while (offset < command.length) {
		const header = shellLine(command, offset);
		if (!header) return fallback();
		const documents = analyzeHeader(header.tokens, command, ranges);
		if (!documents) return fallback();
		offset = header.end;
		for (const document of documents) {
			const bodyStart = offset;
			let found = false;
			while (offset < command.length) {
				const newline = command.indexOf("\n", offset);
				const end = newline < 0 ? command.length : newline + 1;
				let line = command.slice(offset, newline < 0 ? end : newline);
				if (newline >= 0 && line.endsWith("\r")) line = line.slice(0, -1);
				if (document.tabs) line = line.replace(/^\t+/, "");
				if (line === document.delimiter) {
					if (document.language && offset > bodyStart) ranges.push({ start: bodyStart, end: offset, language: document.language });
					offset = end;
					found = true;
					break;
				}
				offset = end;
			}
			if (!found) return fallback();
		}
	}
	ranges.sort((a, b) => a.start - b.start);
	const segments: ScriptSegment[] = [];
	const append = (source: string, language: string) => {
		if (!source) return;
		const previous = segments[segments.length - 1];
		if (previous?.language === language) previous.source += source;
		else segments.push({ source, language });
	};
	offset = 0;
	for (const range of ranges) {
		if (range.start < offset) return fallback();
		append(command.slice(offset, range.start), "bash");
		append(command.slice(range.start, range.end), range.language);
		offset = range.end;
	}
	append(command.slice(offset), "bash");
	return segments.length ? segments : fallback();
}
