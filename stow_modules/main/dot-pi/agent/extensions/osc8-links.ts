import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as piTui from "@earendil-works/pi-tui";

const PATCH_STATE_SYMBOL = Symbol.for("pi.osc8Links.patchState");
const OSC8_CLOSE = "\x1b]8;;\x1b\\";

// Matches a complete raw OSC 8 sequence: ESC ] 8 ; params ; url (BEL | ST) text ESC ] 8 ; ; (BEL | ST)
const RAW_OSC8_GLOBAL_REGEX =
	/\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]+)(?:\x07|\x1b\\)([\s\S]*?)\x1b\]8;;(?:\x07|\x1b\\)/g;

const RAW_OSC8_BACKTICK_REGEX =
	/`+\x1b\]8;([^;\x07\x1b]*);([^\x07\x1b]+)(?:\x07|\x1b\\)([^`\x07\x1b]*?)\x1b\]8;;(?:\x07|\x1b\\)`+/g;

// Matches candidate http(s) URLs in plain text, including inline placeholders like <redacted> inside URLs.
const PLAIN_URL_Candidate_REGEX =
	/https?:\/\/(?:<[a-zA-Z0-9_.:-]+>|[^\s<>"'`\x00-\x1f\x7f│┌┐└┘├┤┬┴┼─])+/gi;

const HTML_LAYOUT_TAG_REGEX =
	/^<\/?(?:br|wbr|hr|p|div|span|a|img|code|pre|em|strong|b|i|u|s|del|ins|sub|sup|td|th|tr|table)\b/i;

const HTML_ANCHOR_REGEX = /^<a\s+[^>]*href=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>$/i;

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cjkBreakRegex =
	/[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;

export interface UrlMatch {
	start: number;
	end: number;
	url: string;
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
	if (!text.includes("http://") && !text.includes("https://") && !/https?:\/\//i.test(text)) {
		return [];
	}

	const matches: UrlMatch[] = [];
	PLAIN_URL_Candidate_REGEX.lastIndex = 0;
	let match: RegExpExecArray | null;

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
 * Finds bare http(s) URLs in an ANSI-styled string where no OSC 8 hyperlink is active
 * and wraps their exact character ranges in OSC 8 hyperlinks while preserving all SGR colors.
 */
export function linkifyAnsiLineUrls(line: string, styleUrlPrefix = "", styleUrlSuffix = ""): string {
	if (!line || (!line.includes("http://") && !line.includes("https://") && !/https?:\/\//i.test(line))) {
		return line;
	}

	// Build plain text and map each plain character index to whether an OSC 8 link is already active.
	let plain = "";
	const charHasOsc8: boolean[] = [];
	let activeOsc8 = false;
	let i = 0;

	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			const parsed = parseOsc8Code(ansi.code);
			if (parsed !== undefined) {
				activeOsc8 = parsed !== null;
			}
			i += ansi.length;
			continue;
		}
		plain += line[i];
		charHasOsc8.push(activeOsc8);
		i++;
	}

	const urlMatches = findUrlsInPlainText(plain).filter((m) => {
		for (let idx = m.start; idx < m.end; idx++) {
			if (charHasOsc8[idx]) return false;
		}
		return true;
	});

	if (urlMatches.length === 0) {
		return line;
	}

	const openAtPlainIdx = new Map<number, string>();
	const closeAtPlainIdx = new Map<number, boolean>();
	for (const match of urlMatches) {
		openAtPlainIdx.set(match.start, match.url);
		closeAtPlainIdx.set(match.end, true);
	}

	let out = "";
	let plainIdx = 0;
	i = 0;
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			out += ansi.code;
			i += ansi.length;
			continue;
		}

		const openUrl = openAtPlainIdx.get(plainIdx);
		if (openUrl !== undefined) {
			out += `\x1b]8;;${openUrl}\x1b\\${styleUrlPrefix}`;
		}

		out += line[i];
		plainIdx++;
		i++;

		if (closeAtPlainIdx.get(plainIdx)) {
			out += `${styleUrlSuffix}${OSC8_CLOSE}`;
		}
	}

	return out;
}

export function linkifyAnsiTextUrls(text: string, styleUrlPrefix = "", styleUrlSuffix = ""): string {
	if (!text || (!text.includes("http://") && !text.includes("https://") && !/https?:\/\//i.test(text))) {
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
		}

		coalesced.push(current);
		i++;
	}

	return coalesced;
}

type PatchState = {
	installed: boolean;
	origMarkdownRender: typeof piTui.Markdown.prototype.render;
	origMarkdownRenderInlineTokens: (tokens: InlineToken[], styleContext?: unknown) => string;
	origMarkdownRenderToken: (
		token: unknown,
		width: number,
		nextTokenType?: string,
		styleContext?: unknown,
	) => string[];
	origMarkdownWrapCellText: (text: string, maxWidth: number, stylePrefix?: string) => string[];
	origTextRender: typeof piTui.Text.prototype.render;
	origTruncatedTextRender: typeof piTui.TruncatedText.prototype.render;
};

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
		origMarkdownRender: mdProto.render,
		origMarkdownRenderInlineTokens: mdProto.renderInlineTokens,
		origMarkdownRenderToken: mdProto.renderToken,
		origMarkdownWrapCellText: mdProto.wrapCellText,
		origTextRender: tui.Text.prototype.render,
		origTruncatedTextRender: tui.TruncatedText.prototype.render,
	};
	globalHolder[PATCH_STATE_SYMBOL] = state;

	mdProto.render = function (this: typeof mdProto, width: number): string[] {
		enableOsc8Hyperlinks(tui);
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
								(urlText, url) => tui.hyperlink(this.theme.underline(this.theme.code(urlText)), url),
								(chunk) => this.theme.code(chunk),
							) + stylePrefix;
					}
					break;
				}
				case "link": {
					const href = String(token.href ?? "");
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
							: String(token.text ?? href);
					const styledLink = linkStyleFn(innerText || href);
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
				case "html": {
					const rawHtml = typeof token.raw === "string" ? token.raw : String(token.text ?? "");
					const anchorMatch = HTML_ANCHOR_REGEX.exec(rawHtml.trim());
					if (!inLink && anchorMatch) {
						const href = (anchorMatch[1] ?? anchorMatch[2] ?? anchorMatch[3] ?? "").trim();
						const label = stripTerminalSequencesSafe(anchorMatch[4] ?? "").trim() || href;
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
		return lines.map((line) => linkifyAnsiLineUrls(line));
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
			cachedText?: string;
			cachedWidth?: number;
			cachedLines?: string[];
		};
		const rawText = textHolder.text;
		if (!rawText || rawText.trim() === "") {
			return state.origTextRender.call(this, width);
		}
		if (textHolder.cachedLines && textHolder.cachedText === rawText && textHolder.cachedWidth === width) {
			return textHolder.cachedLines;
		}
		const linkedText = linkifyAnsiTextUrls(rawText);
		textHolder.text = linkedText;
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
}

export default function osc8LinksExtension(pi: ExtensionAPI): void {
	installOsc8LinkRendering(piTui);
	pi.registerMarkdownTransformer((markdown) => normalizeMarkdownForOsc8(markdown));
	pi.on("session_start", () => {
		enableOsc8Hyperlinks(piTui);
	});
}
