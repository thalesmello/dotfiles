// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/index.ts
import { getAgentDir, sessionEntryToContextMessages as sessionEntryToContextMessages2, SettingsManager as SettingsManager2 } from "@earendil-works/pi-coding-agent";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/inline-markdown-wrap.ts
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";
var INLINE_SYNTAX = /[$*\\_`~[<&\t]|www\./i;
var WORD = /(?<=^| )[^ ]*/g;
var BALANCE_MARKERS = /[`*[\]]/;
var BACKTICK_RUN = /`+/g;
var LINK_TARGET = "](";
var UNMARKED = { ticks: 0, stars: 0, depth: 0 };
var PROBE_LEAD = " ";
var PROBE_COLUMNS = 4096;
var GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var plain = {
  heading: identity,
  link: identity,
  linkUrl: identity,
  code: identity,
  codeBlock: identity,
  codeBlockBorder: identity,
  quote: identity,
  quoteBorder: identity,
  hr: identity,
  listBullet: identity,
  bold: identity,
  italic: identity,
  strikethrough: identity,
  underline: identity
};
function identity(text) {
  return text;
}
function wrapInlineMarkdown(line, room) {
  const measure = rememberedWidths();
  if (measure(line) <= room)
    return [line];
  const pieces = grouped(line, 0, inlineBalance).flatMap((atom) => fitted(atom, room, measure));
  return closedAcrossRows(line, packed(pieces, room));
}
function rememberedWidths() {
  const widths = new Map;
  return (text) => {
    const known = widths.get(text);
    if (known !== undefined)
      return known;
    const width = drawnWidth(text);
    widths.set(text, width);
    return width;
  };
}
function drawnWidth(text) {
  if (!INLINE_SYNTAX.test(text))
    return visibleWidth(text.trimEnd());
  const markdown = new Markdown(`${PROBE_LEAD}${text}`, 0, 0, plain, undefined, {
    renderLatex: false,
    preserveBackslashEscapes: true
  });
  const drawn = stripVTControlCharacters(markdown.render(PROBE_COLUMNS)[0] ?? "").trimEnd();
  return Math.max(0, visibleWidth(drawn) - 1);
}
function partsOf(text, offset) {
  return Array.from(text.matchAll(WORD), (match) => ({
    text: match[0],
    start: offset + match.index,
    end: offset + match.index + match[0].length
  }));
}
function inlineBalance(balance) {
  return `${balance.ticks % 2}:${balance.stars % 2}:${balance.depth}`;
}
function linkBalance(balance) {
  return `${balance.depth}`;
}
function grouped(text, offset, keyOf) {
  const words = partsOf(text, offset);
  const keys = balances(words).map(keyOf);
  const bounds = [];
  let closesAt = 0;
  for (const [index, key] of keys.entries()) {
    const word = words[index];
    if (word === undefined)
      break;
    const open = bounds.at(-1);
    if (index < closesAt && open !== undefined) {
      bounds[bounds.length - 1] = { start: open.start, end: word.end };
      continue;
    }
    const balancedAt = keys.indexOf(key, index + 1);
    closesAt = balancedAt < 0 ? index + 1 : balancedAt;
    bounds.push({ start: word.start, end: word.end });
  }
  return bounds.map(({ start, end }) => ({ text: text.slice(start - offset, end - offset), start, end }));
}
function balances(words) {
  const totals = [UNMARKED];
  let total = UNMARKED;
  for (const { text } of words) {
    if (BALANCE_MARKERS.test(text))
      total = markedBy(total, text);
    totals.push(total);
  }
  return totals;
}
function markedBy(total, text) {
  return {
    ticks: total.ticks + occurrences(text, "`"),
    stars: total.stars + occurrences(text, "**"),
    depth: total.depth + occurrences(text, "[") - occurrences(text, "]")
  };
}
function occurrences(text, marker) {
  return text.split(marker).length - 1;
}
function fitted(part, room, measure) {
  const width = measure(part.text);
  const whole = { ...part, width, joint: "space" };
  if (width <= room)
    return [whole];
  const links = grouped(part.text, part.start, linkBalance);
  if (links.length > 1)
    return links.flatMap((link) => fitted(link, room, measure));
  if (part.text.includes(LINK_TARGET))
    return [whole];
  const words = partsOf(part.text, part.start);
  return words.length > 1 ? words.flatMap((word) => fitted(word, room, measure)) : hardBroken(part, room, measure);
}
function hardBroken(word, room, measure) {
  const graphemes = Array.from(GRAPHEMES.segment(word.text), ({ segment }) => segment);
  const pieces = [];
  let first = 0;
  while (first < graphemes.length) {
    const end = chunkEnd(graphemes, first, room, measure);
    const text = graphemes.slice(first, end).join("");
    const start = pieces.at(-1)?.end ?? word.start;
    pieces.push({ text, start, end: start + text.length, width: measure(text), joint: first === 0 ? "space" : "flush" });
    first = end;
  }
  return pieces;
}
function chunkEnd(graphemes, first, room, measure) {
  const fits = (end) => measure(graphemes.slice(first, end).join("")) <= room;
  const cellsEnd = cellsFittingEnd(graphemes, first, room);
  return clearOfBackticks(graphemes, first, fits(cellsEnd) ? cellsEnd : widestFit(fits, first + 1, cellsEnd - 1));
}
function clearOfBackticks(graphemes, first, end) {
  if (end <= first + 1 || end >= graphemes.length)
    return end;
  const touches = graphemes[end - 1] === "`" || graphemes[end] === "`";
  return touches ? clearOfBackticks(graphemes, first, end - 1) : end;
}
function cellsFittingEnd(graphemes, first, room) {
  const window = graphemes.slice(first, first + room + 1);
  let cells = 0;
  for (const [offset, grapheme] of window.entries()) {
    cells += visibleWidth(grapheme);
    if (cells > room)
      return first + Math.max(1, offset);
  }
  return first + window.length;
}
function widestFit(fits, low, high) {
  if (low >= high)
    return low;
  const middle = Math.ceil((low + high) / 2);
  return fits(middle) ? widestFit(fits, middle, high) : widestFit(fits, low, middle - 1);
}
function packed(pieces, room) {
  const rows = [];
  for (const piece of pieces) {
    const last = rows.at(-1);
    const grown = last === undefined ? undefined : grownRow(last, piece, room);
    if (grown === undefined)
      rows.push({ start: piece.start, end: piece.end, width: piece.width, gaps: 0 });
    else
      rows[rows.length - 1] = grown;
  }
  return rows;
}
function grownRow(row, piece, room) {
  if (piece.joint === "flush")
    return;
  if (piece.width === 0)
    return { ...row, end: piece.end, gaps: row.gaps + 1 };
  const width = row.width + row.gaps + 1 + piece.width;
  return width <= room ? { start: row.start, end: piece.end, width, gaps: 0 } : undefined;
}
function closedAcrossRows(line, rows) {
  const spans = line.includes("`") ? codeSpans(line) : [];
  const reopened = rows.map((row, index) => {
    const above = rows[index - 1];
    return above === undefined ? "" : fenceAcross(spans, above.end, row.start);
  });
  return rows.map((row, index) => `${reopened[index] ?? ""}${line.slice(row.start, row.end)}${reopened[index + 1] ?? ""}`);
}
function fenceAcross(spans, upperEnd, lowerStart) {
  return spans.find((span) => span.from < upperEnd && lowerStart < span.to)?.fence ?? "";
}
function codeSpans(line) {
  const runs = Array.from(line.matchAll(BACKTICK_RUN), (match) => ({ fence: match[0], at: match.index }));
  const spans = [];
  let pairedUntil = 0;
  for (const [index, opener] of runs.entries()) {
    if (index < pairedUntil || escapedAt(line, opener.at))
      continue;
    const closing = runs.findIndex((run, at) => at > index && run.fence === opener.fence);
    const closer = runs[closing];
    if (closer === undefined)
      continue;
    spans.push({ fence: opener.fence, from: opener.at + opener.fence.length, to: closer.at });
    pairedUntil = closing + 1;
  }
  return spans;
}
function escapedAt(line, at) {
  return backslashesBefore(line, at) % 2 === 1;
}
function backslashesBefore(line, at) {
  return line[at - 1] === "\\" ? 1 + backslashesBefore(line, at - 1) : 0;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/message-orientation.ts
var PLAIN_INK = { words: "", mark: "" };
var SENT_PAD = " ";
var SENT_RAIL = "┃";
var NARROWEST_RAIL = 8;
var RAIL_COLUMNS = 2;
var FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})(.*)/;
var FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;
function orientMessage(markdown, context, ink) {
  if (context.messageType !== "user" || markdown.trim() === "")
    return markdown;
  const blocks = fencedBlocks(markdown).map(squeezed);
  return placeSent(blocks, context.availableWidth, ink);
}
function fencedBlocks(markdown) {
  const blocks = [];
  let prose = [];
  let code;
  for (const line of markdown.split(`
`)) {
    if (code !== undefined) {
      code.lines.push(line);
      if (closesFence(line, code.fence)) {
        blocks.push({ kind: "code", lines: code.lines });
        code = undefined;
      }
      continue;
    }
    const fence = openedFence(line);
    if (fence === undefined) {
      prose.push(line);
      continue;
    }
    if (prose.length > 0)
      blocks.push({ kind: "prose", lines: prose });
    prose = [];
    code = { fence, lines: [line] };
  }
  if (code !== undefined)
    blocks.push({ kind: "code", lines: code.lines });
  if (prose.length > 0)
    blocks.push({ kind: "prose", lines: prose });
  return blocks;
}
function openedFence(line) {
  const [, fence, info] = FENCE_OPENER.exec(line) ?? [];
  if (fence === undefined)
    return;
  return fence.startsWith("`") && info?.includes("`") ? undefined : fence;
}
function closesFence(line, fence) {
  const closer = FENCE_CLOSER.exec(line)?.[1];
  return closer !== undefined && closer[0] === fence[0] && closer.length >= fence.length;
}
function squeezed(block) {
  if (block.kind === "code")
    return block;
  const lines = block.lines.filter((line, index) => !(isBlank(line) && block.lines[index - 1]?.trim() === ""));
  return { kind: "prose", lines };
}
function isBlank(line) {
  return line.trim() === "";
}
function joined(blocks) {
  return blocks.flatMap((block) => block.lines).join(`
`);
}
function placeSent(blocks, width, ink) {
  if (width < NARROWEST_RAIL)
    return joined(blocks);
  const room = width - RAIL_COLUMNS;
  const first = blocks.find((block) => block.lines.some((line) => !isBlank(line)));
  const body = blocks.flatMap((block) => placedBlock(block, room, ink)).join(`

`);
  return first?.kind === "code" ? `${ink.mark}${SENT_RAIL}${ink.words}

${body}` : body;
}
function placedBlock(block, room, ink) {
  if (block.kind === "code")
    return [block.lines.join(`
`)];
  const first = block.lines.findIndex((line) => !isBlank(line));
  if (first < 0)
    return [];
  const last = block.lines.reduce((found, line, index) => isBlank(line) ? found : index, first);
  return [railSent(block.lines.slice(first, last + 1), room, ink)];
}
function railSent(lines, room, ink) {
  const rows = lines.flatMap((line) => isBlank(line) ? [""] : wrapInlineMarkdown(line, room));
  return rows.map((row) => {
    if (isBlank(row))
      return "";
    return `${ink.mark}${SENT_RAIL}${SENT_PAD}${ink.words}${row}`;
  }).join(`
`);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/backgroundless-theme.ts
var CONTENT_BACKGROUNDS = new Set([
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg"
]);
var OPEN_CANVAS = "\x1B[49m";
var RENDER_COLORS = [
  "accent",
  "text",
  "muted",
  "dim",
  "success",
  "error",
  "warning",
  "toolTitle",
  "toolOutput",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation"
];
function renderPalette(theme) {
  return RENDER_COLORS.map((color) => theme.getFgAnsi(color)).join("|");
}
var INSTALLED_THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");
function isThemeInstance(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && "getFgAnsi" in prototype && "bg" in prototype;
}
function parseInstalledTheme(slot) {
  const installed = slot?.value;
  return isThemeInstance(installed) ? installed : undefined;
}
function liveTheme() {
  return parseInstalledTheme(Object.getOwnPropertyDescriptor(globalThis, INSTALLED_THEME));
}
function backgroundlessForeground(color) {
  if (color === "userMessageText" || color === "customMessageText" || color === "toolOutput")
    return "text";
  if (color === "thinkingText")
    return "muted";
  return color;
}
function quietLiveTheme() {
  const theme = liveTheme();
  if (globalThis.piZenQuietTheme?.theme === theme)
    return theme;
  restoreLiveTheme();
  if (theme === undefined)
    return;
  const canvas = {
    bg: theme.bg,
    fg: theme.fg,
    getBgAnsi: theme.getBgAnsi,
    getFgAnsi: theme.getFgAnsi
  };
  theme.getBgAnsi = (color) => CONTENT_BACKGROUNDS.has(color) ? OPEN_CANVAS : canvas.getBgAnsi.call(theme, color);
  theme.bg = (color, text) => CONTENT_BACKGROUNDS.has(color) ? text : canvas.bg.call(theme, color, text);
  theme.getFgAnsi = (color) => canvas.getFgAnsi.call(theme, backgroundlessForeground(color));
  theme.fg = (color, text) => color === "mdCodeBlockBorder" ? "" : canvas.fg.call(theme, backgroundlessForeground(color), text);
  globalThis.piZenQuietTheme = { theme, canvas };
  return theme;
}
function restoreLiveTheme() {
  const quiet = globalThis.piZenQuietTheme;
  if (quiet === undefined)
    return;
  globalThis.piZenQuietTheme = undefined;
  Object.assign(quiet.theme, quiet.canvas);
}
function liveSentInk() {
  const theme = liveTheme();
  if (theme === undefined)
    return PLAIN_INK;
  return {
    words: theme.getFgAnsi("text"),
    mark: theme.getFgAnsi("border")
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/call-group.ts
import { MouseRegion, truncateToWidth as truncateToWidth2 } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/pi-renderers.ts
import { Container } from "@earendil-works/pi-tui";
function rowMemory(context) {
  return context.state;
}
function elapsedOf(context) {
  if (context.durationMs !== undefined)
    return context.durationMs;
  const { startedAt, endedAt } = rowMemory(context);
  return startedAt === undefined || endedAt === undefined ? undefined : endedAt - startedAt;
}
function startClock(context, now) {
  if (context.executionStarted)
    rowMemory(context).startedAt ??= now();
}
function settleClock(memory, now) {
  memory.endedAt ??= now();
  if (memory.interval === undefined)
    return;
  clearInterval(memory.interval);
  memory.interval = undefined;
}
var RIGHT_MARGIN = 1;
function padded(component, padding) {
  const indent = " ".repeat(padding);
  return {
    render: (width) => {
      const room = width - padding * 2 - RIGHT_MARGIN;
      return room > 0 ? component.render(room).map((line) => indent + line) : [];
    },
    invalidate: () => component.invalidate()
  };
}
function selfShell(showsZen, renderCall, renderResult) {
  return {
    renderShell: "self",
    renderCall: (args, theme, context) => {
      const component = renderCall(args, theme, context);
      return showsZen() ? padded(component, context.outputPad ?? 0) : component;
    },
    renderResult: (result, options, theme, context) => {
      const component = renderResult(result, options, theme, context);
      return showsZen() ? padded(component, context.outputPad ?? 0) : component;
    }
  };
}
function nothing() {
  return new Container;
}
function piCall(pi, args, theme, context) {
  const slot = pi?.renderCall;
  if (slot === undefined)
    return;
  const memory = rowMemory(context);
  memory.piCall = slot(args, theme, { ...context, lastComponent: memory.piCall });
  return memory.piCall;
}
function piResult(pi, result, options, theme, context) {
  const slot = pi?.renderResult;
  if (slot === undefined)
    return;
  const memory = rowMemory(context);
  memory.piResult = slot(result, options, theme, { ...context, lastComponent: memory.piResult });
  return memory.piResult;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-calls.ts
import { truncateToWidth } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/codemode-script.ts
var OPTIONS = /^\/\/\s*@options\b/;
var CALL = String.raw`tools\.([A-Za-z_$][\w$]*)\s*\(\s*`;
var IDENTIFIER_CHAR = /[\w$]/;
var STRING_LITERAL = String.raw`("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|` + "`" + String.raw`(?:\\.|[^` + "`" + String.raw`\\])*` + "`?)";
var FIELDS = {
  path: field("path"),
  pattern: field("pattern"),
  command: field("command")
};
function field(key) {
  return new RegExp(String.raw`(?:^|[,{])\s*["']?` + key + String.raw`["']?\s*:\s*` + STRING_LITERAL);
}
function parseCodemodeScript(code) {
  return { note: scriptNote(code), calls: scanCode(code, 0, "end of script").calls };
}
function scriptNote(code) {
  const first = code.split(`
`).map((line) => line.trim()).find((line) => line !== "" && !OPTIONS.test(line));
  if (first === undefined || !first.startsWith("//"))
    return;
  const note = first.slice(2).trim();
  return note === "" ? undefined : note;
}
function scanCode(code, start, closing) {
  const calls = [];
  let depth = 0;
  let index = start;
  while (index < code.length) {
    const char = code[index];
    if (code.startsWith("//", index))
      index = lineEnd(code, index);
    else if (code.startsWith("/*", index))
      index = commentEnd(code, index);
    else if (char === "'" || char === '"')
      index = quotedEnd(code, index);
    else if (char === "`") {
      const template = scanTemplate(code, index + 1);
      calls.push(...template.calls);
      index = template.end;
    } else if (char === "{") {
      depth += 1;
      index += 1;
    } else if (char === "}") {
      if (depth === 0 && closing === "closing brace")
        return { calls, end: index + 1 };
      depth = Math.max(0, depth - 1);
      index += 1;
    } else {
      const found = callAt(code, index);
      if (found === undefined)
        index += 1;
      else {
        calls.push(found.call);
        index = found.end;
      }
    }
  }
  return { calls, end: code.length };
}
function scanTemplate(code, start) {
  const calls = [];
  let index = start;
  while (index < code.length) {
    if (code[index] === "\\")
      index += 2;
    else if (code[index] === "`")
      return { calls, end: index + 1 };
    else if (code.startsWith("${", index)) {
      const inner = scanCode(code, index + 2, "closing brace");
      calls.push(...inner.calls);
      index = inner.end;
    } else
      index += 1;
  }
  return { calls, end: code.length };
}
function lineEnd(code, index) {
  const end = code.indexOf(`
`, index);
  return end === -1 ? code.length : end;
}
function commentEnd(code, index) {
  const end = code.indexOf("*/", index + 2);
  return end === -1 ? code.length : end + 2;
}
function quotedEnd(code, index) {
  const quote = code[index];
  let cursor = index + 1;
  while (cursor < code.length && code[cursor] !== quote && code[cursor] !== `
`) {
    cursor += code[cursor] === "\\" ? 2 : 1;
  }
  return Math.min(code.length, cursor + 1);
}
function callAt(code, index) {
  if (!code.startsWith("tools.", index))
    return;
  if (index > 0 && IDENTIFIER_CHAR.test(code[index - 1] ?? ""))
    return;
  const call = new RegExp(CALL, "y");
  call.lastIndex = index;
  const match = call.exec(code);
  const name = match?.[1];
  if (match === null || name === undefined)
    return;
  const argumentStart = index + match[0].length;
  const object = code[argumentStart] === "{" ? objectEnd(code, argumentStart) : undefined;
  if (object === undefined)
    return { call: { name, input: {} }, end: argumentStart };
  return { call: { name, input: fieldsOf(code.slice(argumentStart, object)) }, end: object };
}
function objectEnd(code, index) {
  let depth = 0;
  let cursor = index;
  while (cursor < code.length) {
    const char = code[cursor];
    if (char === "'" || char === '"')
      cursor = quotedEnd(code, cursor);
    else if (char === "`")
      cursor = scanTemplate(code, cursor + 1).end;
    else {
      if (char === "{")
        depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0)
          return cursor + 1;
      }
      cursor += 1;
    }
  }
  return;
}
function fieldsOf(source) {
  return {
    path: stringField(source, FIELDS.path),
    pattern: stringField(source, FIELDS.pattern),
    command: stringField(source, FIELDS.command)
  };
}
function unquoted(literal) {
  const quote = literal[0] ?? "";
  return literal.length > 1 && literal.endsWith(quote) ? literal.slice(1, -1) : literal.slice(1);
}
function stringField(source, pattern) {
  const literal = pattern.exec(source)?.[1];
  if (literal === undefined)
    return;
  return unquoted(literal).replace(/\\$/, "").replace(/\\(.)/g, (_match, char) => char === "n" ? `
` : char);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/display-path.ts
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { visibleWidth as visibleWidth2 } from "@earendil-works/pi-tui";
var READABLE_PATH = 56;
var ELLIPSIS = "…";
var GRAPHEMES2 = new Intl.Segmenter(undefined, { granularity: "grapheme" });
var SEPARATORS = sep === "/" ? /\/+/ : /[\\/]+/;
function displayPath(path, cwd) {
  if (path === "")
    return path;
  const absolute = resolve(cwd, path);
  const inside = relative(cwd, absolute);
  if (inside === "")
    return ".";
  if (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
    return shortenPath(inside, READABLE_PATH);
  const home = homedir();
  const inHome = home !== "" && absolute.startsWith(`${home}${sep}`);
  return shortenPath(inHome ? `~${absolute.slice(home.length)}` : absolute, READABLE_PATH);
}
function shortenPath(path, max) {
  if (max <= 0)
    return "";
  if (visibleWidth2(path) <= max)
    return path;
  const parts = path.split(SEPARATORS).filter((part) => part.length > 0);
  const file = parts.at(-1);
  if (file === undefined || parts.length === 1)
    return keepEnd(file ?? path, max);
  const tails = parts.slice(0, -1).reverse().reduce((grown, segment) => [...grown, `${segment}${sep}${grown.at(-1) ?? file}`], [file]);
  const longest = tails.filter((tail) => visibleWidth2(`${ELLIPSIS}${sep}${tail}`) <= max).at(-1);
  return longest === undefined ? keepEnd(file, max) : `${ELLIPSIS}${sep}${longest}`;
}
function keepEnd(text, max) {
  if (visibleWidth2(text) <= max)
    return text;
  const room = max - visibleWidth2(ELLIPSIS);
  if (room <= 0)
    return ELLIPSIS.slice(0, max);
  const graphemes = Array.from(GRAPHEMES2.segment(text), (part) => part.segment);
  const widths = graphemes.map((grapheme) => visibleWidth2(grapheme));
  const start = widths.findIndex((_width, index) => widths.slice(index).reduce((sum, width) => sum + width, 0) <= room);
  return ELLIPSIS + (start === -1 ? "" : graphemes.slice(start).join(""));
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/value-guards.ts
function isRecordOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseRecord(value, fallback) {
  return isRecordOf(value) ? value : fallback;
}
function isString(value) {
  return typeof value === "string";
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-calls.ts
var CODEMODE = "codemode";
function mcpToolName(name) {
  if (name === "list_mcp_resources" || name === "list_mcp_resource_templates" || name === "read_mcp_resource")
    return name;
  const match = /^mcp__([\w-]+?)__(.+)$/.exec(name);
  const server = match?.[1];
  const tool = match?.[2];
  return server === undefined || tool === undefined ? undefined : `${server}/${tool}`;
}
function displayToolName(name) {
  return mcpToolName(name) ?? name;
}
function hasZenToolView(name) {
  return name === CODEMODE || builtInTool(name) !== undefined || mcpToolName(name) !== undefined;
}
var NO_INPUT = {};
function toolInput(value) {
  return parseRecord(value, NO_INPUT);
}
function presentText(value) {
  return isString(value) && value.trim() !== "" ? value : undefined;
}
function positiveInteger(value) {
  const parsed = isString(value) && value.trim() !== "" ? Number(value) : value;
  return isFiniteNumber(parsed) && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function firstLine(text) {
  return text.split(`
`).find((line) => line.trim() !== "")?.trim() ?? "";
}
function commandHead(command) {
  const lines = command.split(`
`).filter((line) => line.trim() !== "");
  const head = lines.at(0)?.trim() ?? "";
  if (lines.length > 1)
    return "shell script";
  return head.length > 64 || /[;&|<>`$(){}]/.test(head) ? "shell command" : head;
}
var pathSubject = (input, cwd) => {
  const path = presentText(input.path);
  return path === undefined ? undefined : { text: displayPath(firstLine(path), cwd), elide: "path" };
};
var listSubject = (input, cwd) => ({
  text: displayPath(firstLine(presentText(input.path) ?? "."), cwd),
  elide: "path"
});
var patternSubject = (input) => {
  const pattern = presentText(input.pattern);
  return pattern === undefined ? undefined : { text: firstLine(pattern), elide: "end" };
};
var commandSubject = (input) => {
  const command = presentText(input.command);
  return command === undefined ? undefined : { text: commandHead(command), elide: "end" };
};
var noteSubject = (input) => {
  const code = presentText(input.code);
  const note = code === undefined ? undefined : scriptNote(code);
  return note === undefined ? undefined : { text: note, elide: "end" };
};
var BUILT_INS = {
  read: { verb: "read", subject: pathSubject },
  edit: { verb: "edit", subject: pathSubject },
  write: { verb: "write", subject: pathSubject },
  bash: { verb: "bash", subject: commandSubject },
  powershell: { verb: "powershell", subject: commandSubject },
  grep: { verb: "grep", subject: patternSubject },
  find: { verb: "find", subject: patternSubject },
  ls: { verb: "ls", subject: listSubject }
};
function isBuiltInTool(name) {
  return Object.hasOwn(BUILT_INS, name);
}
function builtInTool(name) {
  return isBuiltInTool(name) ? name : undefined;
}
function headingOf(tool, input, cwd) {
  const builtIn = BUILT_INS[tool];
  return { verb: builtIn.verb, subject: builtIn.subject(input, cwd) };
}
function callHeading(name, input, cwd) {
  const tool = builtInTool(name);
  if (tool !== undefined)
    return headingOf(tool, input, cwd);
  if (name === CODEMODE)
    return { verb: CODEMODE, subject: noteSubject(input, cwd) };
  const mcp = mcpToolName(name);
  if (mcp !== undefined)
    return { verb: "mcp", subject: { text: mcp, elide: "end" } };
  return {
    verb: name,
    subject: pathSubject(input, cwd) ?? patternSubject(input, cwd) ?? commandSubject(input, cwd)
  };
}
function headingLabel(heading) {
  return heading.subject === undefined ? heading.verb : `${heading.verb} ${heading.subject.text}`;
}
function labelToolCall(name, input, cwd) {
  return headingLabel(callHeading(name, input, cwd));
}
function workLabel(name, input, cwd) {
  const heading = callHeading(name, input, cwd);
  const command = name === "bash" || name === "powershell" ? presentText(input.command) : undefined;
  const subject = command === undefined ? heading.subject?.text : firstLine(command);
  const phrase = workVerb(name, input);
  const label = subject === undefined || name === CODEMODE || mcpToolName(name) !== undefined ? phrase : `${phrase} ${subject}`;
  return truncateToWidth(label, 52, "…");
}
function workVerb(name, input) {
  if (name === CODEMODE)
    return scriptNote(scriptSource(input)) ?? "running a script";
  switch (builtInTool(name)) {
    case "read":
      return "reading";
    case "grep":
    case "find":
      return "searching";
    case "ls":
      return "listing files";
    case "edit":
      return "editing";
    case "write":
      return "writing";
    case "bash":
    case "powershell":
      return "running";
    case undefined:
      return displayToolName(name);
  }
}
function readSpan(input) {
  return {
    path: presentText(input.path),
    offset: positiveInteger(input.offset),
    limit: positiveInteger(input.limit)
  };
}
function writtenFile(input) {
  return { path: presentText(input.path), content: isString(input.content) ? input.content : "" };
}
function scriptSource(input) {
  return presentText(input.code) ?? "";
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/call-group.ts
function createCallRuns(rebuild = () => {}) {
  const seats = new Map;
  let open;
  return {
    join: (id, name, owner) => {
      let existing = seats.get(id);
      if (owner !== undefined && existing?.member.owner !== undefined && existing.member.owner !== owner) {
        rebuild();
        existing = seats.get(id);
      }
      if (existing !== undefined) {
        if (owner !== undefined)
          existing.member.owner = owner;
        return existing;
      }
      open ??= { members: [], expanded: false, latestSuccess: undefined };
      const member = { name, owner, hasResult: false, failures: 0, running: true };
      open.members.push(member);
      const seat = { run: open, member };
      seats.set(id, seat);
      return seat;
    },
    close: () => {
      open = undefined;
    },
    reset: () => {
      open = undefined;
      seats.clear();
    }
  };
}
function summary(run, expanded, width, theme) {
  const counts = new Map;
  for (const member of run.members) {
    const name = displayToolName(member.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const failures = run.members.reduce((total, member) => total + member.failures, 0);
  const active = run.members.filter((member) => member.running);
  const labels = [...counts].map(([name, count]) => `${count} ${name}`);
  const status = [
    ...failures === 0 ? [] : [`${failures} failed`],
    ...active.length === 0 ? [] : [`running ${active.map((member) => displayToolName(member.name)).join(", ")}`]
  ];
  const tail = status.length === 0 ? "" : ` · ${status.join(" · ")}`;
  const head = `${expanded ? "▾" : "▸"} tools  `;
  const room = Math.max(0, width - head.length - tail.length);
  const text = truncateToWidth2(labels.join(" · "), room, "…");
  return truncateToWidth2(theme.fg("muted", head + text) + theme.fg(failures > 0 ? "warning" : "dim", tail), width, "…");
}
function groupedView(seat, own, slot, theme, context) {
  const { run, member } = seat;
  const padding = " ".repeat(context.outputPad ?? 0);
  const component = {
    invalidate: () => own.invalidate(),
    render: (width) => {
      if (member.hasResult !== (slot === "result"))
        return [];
      if (run.members.length < 2)
        return own.render(width);
      const first = run.members[0] === member;
      const room = width - padding.length * 2 - 1;
      const head = first && room > 0 ? [padding + summary(run, run.expanded || context.expanded, room, theme)] : [];
      if (!run.expanded && !context.expanded && member.failures === 0 && !member.running && member !== run.latestSuccess)
        return head;
      const indent = "  ";
      const body = width > indent.length ? own.render(width - indent.length).map((line) => indent + line) : [];
      return [...head, ...body];
    }
  };
  return new MouseRegion(component, (event) => {
    if (run.members.length < 2 || run.members[0] !== member || event.y !== 0 || event.type !== "click" || event.button !== "left")
      return;
    run.expanded = !run.expanded;
    context.invalidate();
    return { handled: true };
  });
}
function ownerOf(context) {
  return rowMemory(context).groupOwner ??= Symbol("zen-tool-row");
}
function groupedRenderers(name, view, runs, showsZen, failures = () => 0) {
  return {
    ...view,
    renderCall: (args, theme, context) => {
      const own = view.renderCall?.(args, theme, context) ?? nothing();
      if (!showsZen())
        return own;
      const seat = runs.join(context.toolCallId, name, ownerOf(context));
      return groupedView(seat, own, "call", theme, context);
    },
    renderResult: (result, options, theme, context) => {
      const own = view.renderResult?.(result, options, theme, context) ?? nothing();
      if (!showsZen())
        return own;
      const seat = runs.join(context.toolCallId, name, ownerOf(context));
      const wasRunning = seat.member.running;
      seat.member.hasResult = true;
      seat.member.running = options.isPartial;
      seat.member.failures = Math.max(context.isError ? 1 : 0, failures(result));
      if (wasRunning && !options.isPartial && seat.member.failures === 0)
        seat.run.latestSuccess = seat.member;
      return groupedView(seat, own, "result", theme, context);
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/prompt-history.ts
import {
  sessionEntryToContextMessages
} from "@earendil-works/pi-coding-agent";
var LIMIT = 100;
function rememberPrompt(newestFirst, text) {
  const trimmed = text.trim();
  if (trimmed === "" || newestFirst[0] === trimmed)
    return newestFirst;
  return [trimmed, ...newestFirst].slice(0, LIMIT);
}
function isPlainText(content) {
  return typeof content === "string";
}
function promptText(message) {
  if (message.role !== "user")
    return [];
  const text = isPlainText(message.content) ? message.content : message.content.map((block) => block.type === "text" ? block.text : "").join("");
  return text === "" ? [] : [text];
}
function sessionPrompts(session) {
  return session.buildContextEntries().flatMap(sessionEntryToContextMessages).flatMap(promptText);
}
function withSessionOnTop(newestFirst, sessionOldestFirst) {
  const session = sessionOldestFirst.reduce(rememberPrompt, []);
  const inSession = new Set(session);
  return [...session, ...newestFirst.filter((prompt) => !inSession.has(prompt))].slice(0, LIMIT);
}
function carriesSessionPrompts(occasion) {
  switch (occasion) {
    case "startup":
    case "reload":
      return true;
    case "new":
    case "resume":
    case "fork":
    case "zen on":
      return false;
  }
}
function carriedPromptHistory() {
  const newestFirst = () => globalThis.piZenPromptHistory ?? [];
  return {
    replay: (add) => {
      for (const prompt of [...newestFirst()].reverse())
        add(prompt);
    },
    remember: (text) => {
      globalThis.piZenPromptHistory = rememberPrompt(newestFirst(), text);
    },
    seed: (session, occasion) => {
      if (carriesSessionPrompts(occasion))
        return;
      globalThis.piZenPromptHistory = withSessionOnTop(newestFirst(), sessionPrompts(session));
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/reasoning-view.ts
import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container as Container2 } from "@earendil-works/pi-tui";
var WIDGET_KEY = "zen-reasoning";
function assistantMessages(children) {
  return children.flatMap((child) => {
    if (child instanceof AssistantMessageComponent)
      return [child];
    return child instanceof Container2 ? assistantMessages(child.children) : [];
  });
}
function mountReasoning(tui, nativeHidden) {
  const configured = new WeakMap;
  let hidden = false;
  let previousNative = nativeHidden();
  const previousRender = tui.requestRender;
  let active = true;
  const requestRender = (force) => {
    if (active) {
      for (const message of assistantMessages(tui.children)) {
        if (configured.has(message))
          continue;
        const currentNative = nativeHidden();
        if (currentNative !== previousNative)
          hidden = currentNative;
        previousNative = currentNative;
        const original = message.setHideThinkingBlock;
        const observed = (hide) => {
          hidden = hide;
          original.call(message, hide);
        };
        configured.set(message, { original, observed });
        original.call(message, hidden);
        message.setHideThinkingBlock = observed;
      }
    }
    previousRender.call(tui, force);
  };
  const dispose = () => {
    active = false;
    if (tui.requestRender === requestRender)
      tui.requestRender = previousRender;
    for (const message of assistantMessages(tui.children)) {
      const setter = configured.get(message);
      if (setter !== undefined && message.setHideThinkingBlock === setter.observed)
        message.setHideThinkingBlock = setter.original;
    }
  };
  tui.requestRender = requestRender;
  requestRender();
  return {
    restore: (nativeHidden) => {
      dispose();
      for (const message of assistantMessages(tui.children)) {
        if (configured.has(message))
          message.setHideThinkingBlock(nativeHidden);
      }
    },
    dispose
  };
}
function createReasoningView(preferences) {
  let mounted;
  return {
    show: (ui) => {
      if (mounted !== undefined)
        return;
      ui.setWidget(WIDGET_KEY, (tui) => {
        const mount = mountReasoning(tui, preferences.nativeHidden);
        mounted = mount;
        return {
          render: () => [],
          invalidate: () => {},
          dispose: () => {
            mount.dispose();
            if (mounted === mount)
              mounted = undefined;
          }
        };
      });
    },
    hide: (ui) => {
      mounted?.restore(preferences.nativeHidden());
      ui.setWidget(WIDGET_KEY, undefined);
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/silent-header.ts
import { Container as Container3 } from "@earendil-works/pi-tui";
var silentHeader = {
  show: (ui) => ui.setHeader(() => new Container3),
  hide: (ui) => ui.setHeader(undefined)
};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/startup-quieting.ts
import { SettingsManager } from "@earendil-works/pi-coding-agent";
var inMemoryStartupQuieting = {
  quiet: async () => ({ _tag: "AlreadyQuiet" }),
  restore: async () => ({ _tag: "NothingToRestore" })
};

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/loading-bar.ts
var LOADING_INTERVAL_MS = 32;
var BAR_WIDTH = 7;
var STEPS = 28;
var CYCLE = STEPS * 2 - 2;
function lightPosition(frame) {
  const step = frame % CYCLE;
  return (step < STEPS ? step : CYCLE - step) / (STEPS - 1);
}
function loadingFrames(shade) {
  return Array.from({ length: CYCLE }, (_, frame) => {
    const peak = lightPosition(frame) * (BAR_WIDTH + 1) - 0.5;
    return Array.from({ length: BAR_WIDTH }, (_, cell) => {
      const falloff = Math.max(0, 1 - Math.abs(cell - peak) / 1.7);
      return shade(falloff * falloff, "━");
    }).join("");
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/working-indicator.ts
var ANSI_GRAY = { r: 187, g: 187, b: 187 };
var ANSI16 = [
  { r: 0, g: 0, b: 0 },
  { r: 187, g: 0, b: 0 },
  { r: 0, g: 187, b: 0 },
  { r: 187, g: 187, b: 0 },
  { r: 0, g: 0, b: 187 },
  { r: 187, g: 0, b: 187 },
  { r: 0, g: 187, b: 187 },
  ANSI_GRAY,
  { r: 85, g: 85, b: 85 },
  { r: 255, g: 85, b: 85 },
  { r: 85, g: 255, b: 85 },
  { r: 255, g: 255, b: 85 },
  { r: 85, g: 85, b: 255 },
  { r: 255, g: 85, b: 255 },
  { r: 85, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 }
];
var CUBE = [0, 95, 135, 175, 215, 255];
function rgbOfIndexed(index) {
  if (index < 16)
    return ANSI16[index] ?? ANSI_GRAY;
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }
  const cube = index - 16;
  return {
    r: CUBE[Math.floor(cube / 36)] ?? 0,
    g: CUBE[Math.floor(cube / 6) % 6] ?? 0,
    b: CUBE[cube % 6] ?? 0
  };
}
function channel(ansi, marker) {
  const start = ansi.indexOf(marker);
  if (start === -1)
    return;
  const rest = ansi.slice(start + marker.length);
  const end = rest.indexOf("m");
  if (end === -1)
    return;
  return rest.slice(0, end);
}
function rgbOf(ansi) {
  const truecolor = channel(ansi, "\x1B[38;2;");
  if (truecolor) {
    const [r, g, b] = truecolor.split(";");
    if (r !== undefined && g !== undefined && b !== undefined) {
      return { r: Number(r), g: Number(g), b: Number(b) };
    }
  }
  const indexed = channel(ansi, "\x1B[38;5;");
  if (!indexed)
    return;
  return rgbOfIndexed(Number(indexed));
}
function mix(from, to, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t)
  };
}
function shadeFor(theme) {
  const dim = rgbOf(theme.getFgAnsi("dim"));
  const text = rgbOf(theme.getFgAnsi("text"));
  if (!dim || !text) {
    return (amount, glyph) => theme.fg(amount > 0.55 ? "text" : "dim", glyph);
  }
  return (amount, glyph) => {
    const color = mix(dim, text, amount);
    return `\x1B[38;2;${color.r};${color.g};${color.b}m${glyph}\x1B[39m`;
  };
}
function installWorkingIndicator(ui) {
  ui.setWorkingIndicator({
    frames: loadingFrames(shadeFor(ui.theme)),
    intervalMs: LOADING_INTERVAL_MS
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/theme-follow.ts
function createThemeFollow() {
  let following;
  let followUp;
  const draw = (ui) => {
    const drawnFor = quietLiveTheme();
    installWorkingIndicator(ui);
    following = { ui, drawnFor };
  };
  const whenThemeMoved = (act) => {
    if (following !== undefined && quietLiveTheme() !== following.drawnFor)
      act(following.ui);
  };
  const sync = () => whenThemeMoved(draw);
  const syncSoon = () => {
    if (followUp !== undefined)
      return;
    followUp = setTimeout(() => {
      followUp = undefined;
      sync();
    }, 0);
    followUp.unref();
  };
  const cancelSync = () => {
    if (followUp === undefined)
      return;
    clearTimeout(followUp);
    followUp = undefined;
  };
  return {
    show: (ui) => {
      draw(ui);
      syncSoon();
    },
    hide: (ui) => {
      cancelSync();
      following = undefined;
      restoreLiveTheme();
      ui.setWorkingIndicator();
    },
    sync,
    syncAfterRender: () => whenThemeMoved(syncSoon)
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-views.ts
import {
  getLanguageFromPath as getLanguageFromPath3
} from "@earendil-works/pi-coding-agent";
import { Box as Box2, Container as Container5, Text as Text2 } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/codemode-view.ts
import { truncateToWidth as truncateToWidth4 } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/source-view.ts
import { stripVTControlCharacters as stripVTControlCharacters2 } from "node:util";
import { getLanguageFromPath, highlightCode } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, visibleWidth as visibleWidth3, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/width-cache.ts
function widthCached(draw, parts) {
  let drawn;
  return {
    render: (width) => {
      if (drawn?.width !== width)
        drawn = { width, lines: draw(width) };
      return drawn.lines;
    },
    invalidate: () => {
      drawn = undefined;
      for (const part of parts)
        part.invalidate();
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/source-view.ts
var TAB = "   ";
var RAIL = " │ ";
var LEADING_SPACE = /^ */;
function isBlank2(line) {
  return stripVTControlCharacters2(line).trim() === "";
}
function withoutTrailingBlanks(lines) {
  const last = lines.reduce((found, line, index) => isBlank2(line) ? found : index, -1);
  return lines.slice(0, last + 1);
}
function frameLine(line, lineNumber, room, gutter) {
  const indent = LEADING_SPACE.exec(stripVTControlCharacters2(line))?.[0] ?? "";
  const width = visibleWidth3(line);
  const hangs = width > room && indent.length > 0 && indent.length * 2 <= room;
  const body = hangs ? sliceByColumn(line, indent.length, width - indent.length) : line;
  const bodyRoom = hangs ? room - indent.length : room;
  const chunks = visibleWidth3(body) <= bodyRoom ? [body] : wrapTextWithAnsi(body, bodyRoom);
  const hang = hangs ? indent : "";
  return chunks.map((chunk, index) => (index === 0 ? gutter.numbered(lineNumber) : gutter.continued) + hang + chunk);
}
function frameSource(lines, startLine, width, theme) {
  const kept = withoutTrailingBlanks(lines);
  const gutterWidth = Math.max(2, String(startLine + kept.length - 1).length);
  const room = width - gutterWidth - RAIL.length;
  if (kept.length === 0 || room <= 0)
    return [];
  const gutter = {
    numbered: (lineNumber) => theme.fg("dim", `${String(lineNumber).padStart(gutterWidth, " ")}${RAIL}`),
    continued: theme.fg("dim", `${" ".repeat(gutterWidth)}${RAIL}`)
  };
  return kept.flatMap((line, index) => frameLine(line, startLine + index, room, gutter));
}
function sourceLayout(file, theme) {
  let colored;
  return widthCached((width) => {
    const palette = renderPalette(liveTheme() ?? theme);
    if (colored === undefined || colored.palette !== palette) {
      colored = { palette, lines: highlightCode(file.text.replaceAll("\t", TAB), getLanguageFromPath(file.path)) };
    }
    return frameSource(colored.lines, file.startLine, width, theme);
  }, []);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-results.ts
import { stripTerminalSequences, visibleWidth as visibleWidth4 } from "@earendil-works/pi-tui";
var TAB2 = 9;
var NEWLINE = 10;
var FIRST_PRINTABLE = 32;
var SPECIALS = { first: 65529, last: 65531 };
var TRAILING_NOTICE = /\n\n\[([^\n]*)\]$/;
var PI_NOTICES = [
  /^\d+ more lines in file\. Use offset=\d+ to continue\.$/,
  /^Showing lines \d+-\d+ of \d+(?: \(\d+(?:\.\d+)?(?:B|KB|MB) limit\))?\. (?:Use offset=\d+ to continue\.|Full output: .+)$/,
  /^Showing last \d+(?:\.\d+)?(?:B|KB|MB) of line \d+ \(line is \d+(?:\.\d+)?(?:B|KB|MB)\)\. Full output: .+$/
];
var PI_LIMIT_NOTICES = [
  /^\d+ (?:results|matches|entries) limit reached(?:\. Use limit=\d+ for more(?:, or refine pattern)?)?$/,
  /^\d+(?:\.\d+)?(?:B|KB|MB) limit reached$/,
  /^Some lines truncated to \d+ chars\. Use read tool to see full lines$/
];
var MATCH_LINE = /:\d+:/;
var NOTHING_FOUND = new Set(["No files found matching pattern", "(empty directory)", "No matches found"]);
var ERRNO_PATH_CLAUSE = /,\s*(?:access|open|stat|lstat|scandir|read|write|unlink|mkdir|rmdir|copyfile|rename)\s+'[^']*'\s*$/;
var BASH_STATUS = /^Command (?:exited with code (\d+)|aborted|timed out after (\S+) seconds)$/;
var DIAGNOSTIC = /\b(?:error|fatal|failed|exception|traceback)\b/i;
function isUnprintable(char) {
  const code = char.codePointAt(0) ?? 0;
  return code < FIRST_PRINTABLE && code !== TAB2 && code !== NEWLINE || code >= SPECIALS.first && code <= SPECIALS.last;
}
function printable(text) {
  const stripped = stripTerminalSequences(text);
  const chars = Array.from(stripped);
  return chars.some(isUnprintable) ? chars.filter((char) => !isUnprintable(char)).join("") : stripped;
}
function isPiNotice(notice) {
  if (PI_NOTICES.some((format) => format.test(notice)))
    return true;
  return notice.split(/\. (?=\d|Some lines truncated)/).every((part) => PI_LIMIT_NOTICES.some((format) => format.test(part)));
}
function toolOutput(content) {
  const text = content.filter((block) => block.type === "text").map((block) => printable(block.text ?? "")).join(`
`);
  const trailing = TRAILING_NOTICE.exec(text);
  const notice = trailing !== null && isPiNotice(trailing[1] ?? "") ? trailing : null;
  return {
    body: notice === null ? text : text.slice(0, notice.index),
    notice: notice?.[1],
    image: content.some((block) => block.type === "image")
  };
}
var NO_DETAILS = {};
function toolDetails(value) {
  return parseRecord(value, NO_DETAILS);
}
function isTruncated(details) {
  return details.truncation?.truncated === true;
}
function reachedLimit(details) {
  return [details.matchLimitReached, details.resultLimitReached, details.entryLimitReached].some((limit) => limit !== undefined && limit !== null);
}
function reportedPatch(details) {
  const patch = details.patch;
  return isString(patch) && patch !== "" ? patch : undefined;
}
function listedLines(body) {
  const lines = body.split(`
`).filter((line) => line.trim() !== "");
  return lines.length === 1 && NOTHING_FOUND.has(lines[0]?.trim() ?? "") ? [] : lines;
}
function countListed(body) {
  return listedLines(body).length;
}
function countMatches(body) {
  return listedLines(body).filter((line) => MATCH_LINE.test(line)).length;
}
function countFileLines(text) {
  if (text === "")
    return 0;
  return text.split(`
`).length - (text.endsWith(`
`) ? 1 : 0);
}
function firstActionableLine(output) {
  const first = output.split(`
`).map((line) => line.trim()).find((line) => line !== "");
  return first?.replace(ERRNO_PATH_CLAUSE, "");
}
function shortOutputLine(output) {
  if (output.image || output.notice !== undefined)
    return;
  return shortAnswerLine(output.body, 72);
}
function shortAnswerLine(body, maxWidth) {
  const lines = body.split(`
`).map((line) => line.trim()).filter((line) => line !== "");
  const first = lines.at(0);
  return lines.length === 1 && first !== undefined && !["(no output)", "{}", "[]", "null", "undefined"].includes(first) && visibleWidth4(first) <= maxWidth ? first : undefined;
}
function statusLabel(status) {
  const [, code, timeout] = status;
  if (code !== undefined)
    return `exit ${code}`;
  return timeout === undefined ? "aborted" : `timeout ${timeout}s`;
}
function bashFailureSummary(output) {
  const lines = output.split(`
`).map((line) => line.trim()).filter((line) => line !== "");
  const first = lines.find((line) => !BASH_STATUS.test(line) && DIAGNOSTIC.test(line)) ?? lines.at(0);
  const last = lines.at(-1);
  const status = last === undefined ? null : BASH_STATUS.exec(last);
  if (status === null)
    return first;
  const label = statusLabel(status);
  return first === undefined || first === last || first === "(no output)" ? label : `${label} · ${first}`;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-row.ts
import { truncateToWidth as truncateToWidth3, visibleWidth as visibleWidth5 } from "@earendil-works/pi-tui";
var ROW_MARKER = "-";
var RUNNING = { kind: "running" };
var FAILED_MARKER = "✗";
var VERB_WIDTH = 5;
var GAP = " ";
var DETAIL_GAP = "  ";
var ELLIPSIS2 = "…";
var MIN_SUBJECT_WIDTH = 12;
var MIN_DETAIL_WIDTH = 10;
function quiet(text) {
  return { text, emphasis: "quiet" };
}
function attention(text) {
  return { text, emphasis: "attention" };
}
function settled(detail) {
  return { kind: "settled", detail };
}
function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}
function formatDuration(elapsedMs) {
  const ms = Math.max(0, Math.round(elapsedMs));
  if (ms < 1000)
    return `${ms}ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600)
    return `${(tenths / 10).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
function oneLine(text) {
  return text.replace(/\s*[\r\n]+\s*/g, " ").replaceAll("\t", " ");
}
function elide(text, elision, max) {
  if (max <= 0)
    return "";
  if (visibleWidth5(text) <= max)
    return text;
  return elision === "end" ? truncateToWidth3(text, max, ELLIPSIS2) : shortenPath(text, max);
}
function detailOf(outcome) {
  switch (outcome.kind) {
    case "running":
      return;
    case "failed":
      return outcome.reason === undefined ? undefined : { text: oneLine(outcome.reason), color: "error" };
    case "settled":
      if (outcome.detail === undefined)
        return;
      return {
        text: oneLine(outcome.detail.text),
        color: outcome.detail.emphasis === "attention" ? "warning" : "dim"
      };
  }
}
function fittedDetail(detail, subject, room) {
  const wanted = visibleWidth5(detail.text);
  const subjectNeed = Math.min(visibleWidth5(subject), MIN_SUBJECT_WIDTH);
  const granted = Math.min(wanted, Math.max(0, room - DETAIL_GAP.length - subjectNeed));
  if (granted !== wanted && granted < MIN_DETAIL_WIDTH)
    return;
  return { text: truncateToWidth3(detail.text, granted, ELLIPSIS2), color: detail.color };
}
function formatToolRow(row, width, palette) {
  if (width <= 0)
    return "";
  const failed = row.outcome.kind === "failed";
  const marker = failed ? FAILED_MARKER : ROW_MARKER;
  const verb = row.verb.padEnd(VERB_WIDTH, " ");
  const head = palette.fg(failed ? "error" : "dim", marker) + " " + palette.fg("muted", verb) + GAP;
  const room = width - visibleWidth5(`${marker} ${verb}${GAP}`);
  if (room <= 0)
    return truncateToWidth3(head, width, "");
  const subjectText = row.subject === undefined ? ELLIPSIS2 : oneLine(row.subject.text);
  const wanted = detailOf(row.outcome);
  const detail = wanted === undefined ? undefined : fittedDetail(wanted, subjectText, room);
  const subjectRoom = detail === undefined ? room : room - DETAIL_GAP.length - visibleWidth5(detail.text);
  const subject = elide(subjectText, row.subject?.elide ?? "end", subjectRoom);
  const tail = detail === undefined ? "" : DETAIL_GAP + palette.fg(detail.color, detail.text);
  return head + palette.fg("muted", subject) + tail;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/codemode-view.ts
var HEADER = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/;
var SCRIPT_ERROR = "Script error:";
var ERROR_PREFIX = /^Error:\s*/;
var SHORT_ANSWER = 48;
var OUTPUT_LINES = 8;
var INDENT = "  ";
var ELLIPSIS3 = "…";
var NO_DETAILS2 = {};
var STATUSES = new Set(["running", "ok", "error", "cancelled"]);
function codemodeRenderers(pi, showsZen, now) {
  return selfShell(showsZen, (args, theme, context) => {
    if (!showsZen())
      return piCall(pi, args, theme, context) ?? nothing();
    startClock(context, now);
    if (!context.isPartial)
      return nothing();
    return scriptView(scriptRun(scriptSource(toolInput(args)), { kind: "writing" }, context.cwd), "row", theme);
  }, (result, options, theme, context) => {
    if (!showsZen())
      return piResult(pi, result, options, theme, context) ?? nothing();
    const code = scriptSource(toolInput(context.args));
    if (options.isPartial) {
      const run = scriptRun(code, { kind: "running", result }, context.cwd);
      if (context.expanded)
        return scriptView(run, "steps", theme);
      return scriptView(run, codemodeFailures(result) > 0 ? "failures" : "row", theme);
    }
    const memory = rowMemory(context);
    settleClock(memory, now);
    const progress = context.isError ? { kind: "failed", result } : { kind: "succeeded", result, elapsedMs: elapsedOf(context) };
    return scriptView(scriptRun(code, progress, context.cwd), layoutFor(context), theme);
  });
}
function layoutFor(context) {
  return context.expanded ? "detailed" : "row";
}
function stepLine(step, width, theme) {
  return formatToolRow({ ...step.heading, outcome: step.outcome }, width, theme);
}
function scriptLines(run, layout, source, theme, width) {
  const head = layout === "steps" ? [] : [formatToolRow(run.row, width, theme)];
  const room = width - INDENT.length;
  if (layout === "row" || room <= 0)
    return head;
  const code = source?.render(width) ?? [];
  const steps = layout === "failures" ? run.steps.filter((step) => step.outcome.kind === "failed") : run.steps;
  return [
    ...head,
    ...steps.map((step) => INDENT + stepLine(step, room, theme)),
    ...code.length > 0 ? ["", ...code] : [],
    ...run.output.map((line) => INDENT + theme.fg("dim", truncateToWidth4(line, room, ELLIPSIS3)))
  ];
}
function scriptView(run, layout, theme) {
  const source = (layout === "detailed" || layout === "steps") && run.source !== undefined ? sourceLayout({ path: "script.js", text: run.source, startLine: 1 }, theme) : undefined;
  return widthCached((width) => scriptLines(run, layout, source, theme, width), source === undefined ? [] : [source]);
}
function scriptRun(code, progress, cwd) {
  const script = parseCodemodeScript(code);
  const result = progress.kind === "writing" ? undefined : progress.result;
  const records = result === undefined ? [] : reportedCalls(result.details);
  const steps = records.length > 0 ? records.map((record) => recordStep(record, cwd)) : script.calls.map((call) => scriptStep(call, cwd));
  const output = result === undefined ? [] : outputLines(toolOutput(result.content).body);
  const shown = shownResult(progress, output, steps);
  return {
    row: {
      verb: "codemode",
      subject: { text: script.note ?? nestedToolNames(code, records), elide: "end" },
      outcome: shown.outcome
    },
    steps,
    output: shown.output,
    source: steps.length === 0 && code.trim() !== "" ? code : undefined
  };
}
function shownResult(progress, output, steps) {
  switch (progress.kind) {
    case "writing":
      return { outcome: RUNNING, output: clippedOutput(output) };
    case "running": {
      const failed = steps.filter((step) => step.outcome.kind === "failed").length;
      return {
        outcome: failed > 0 ? settled(attention(`${failed} failed · running`)) : RUNNING,
        output: clippedOutput(output)
      };
    }
    case "failed":
      return { outcome: { kind: "failed", reason: scriptFailure(output) }, output: clippedOutput(output) };
    case "succeeded": {
      const failed = steps.filter((step) => step.outcome.kind === "failed").length;
      if (failed > 0) {
        return {
          outcome: settled(attention(`${plural(steps.length, "call", "calls")} · ${failed} failed`)),
          output: clippedOutput(output)
        };
      }
      const answer = answerOf(output, steps.length, progress.elapsedMs);
      if (answer.kind === "echo")
        return { outcome: settled(quiet(answer.line)), output: [] };
      return {
        outcome: settled(answer.text === undefined ? undefined : quiet(answer.text)),
        output: clippedOutput(output)
      };
    }
  }
}
function codemodeFailures(result) {
  return reportedCalls(result.details).filter((call) => call.status === "error" || call.status === "cancelled").length;
}
function nestedToolNames(code, records) {
  const names = records.length > 0 ? records.map((record) => record.name).filter(isString) : parseCodemodeScript(code).calls.map((call) => call.name);
  const counts = new Map;
  for (const name of names) {
    const label = displayToolName(name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => count === 1 ? name : `${name} ×${count}`).join(", ") || "script";
}
function isPresent(call) {
  return call !== null && call !== undefined;
}
function reportedCalls(details) {
  const calls = parseRecord(details, NO_DETAILS2).calls;
  return Array.isArray(calls) ? calls.filter(isPresent) : [];
}
function isKnownStatus(status) {
  return isString(status) && STATUSES.has(status);
}
function jsonInput(text) {
  try {
    return toolInput(JSON.parse(text));
  } catch {
    return fieldsOf(text);
  }
}
function stepHeading(name, input, cwd) {
  const tool = builtInTool(name);
  if (tool !== undefined)
    return headingOf(tool, input, cwd);
  const mcp = mcpToolName(name);
  if (mcp !== undefined)
    return { verb: "mcp", subject: { text: mcp, elide: "end" } };
  return { verb: "call", subject: { text: labelToolCall(name, input, cwd), elide: "end" } };
}
function recordStep(record, cwd) {
  const name = isString(record.name) && record.name !== "" ? record.name : "call";
  const input = isString(record.args) ? jsonInput(record.args) : toolInput(record.args);
  return { heading: stepHeading(name, input, cwd), outcome: recordOutcome(record) };
}
function scriptStep(call, cwd) {
  return { heading: stepHeading(call.name, call.input, cwd), outcome: RUNNING };
}
function recordOutcome(record) {
  const status = isKnownStatus(record.status) ? record.status : "ok";
  switch (status) {
    case "error":
      return { kind: "failed", reason: isString(record.error) ? firstActionableLine(record.error) : undefined };
    case "cancelled":
      return { kind: "failed", reason: "cancelled" };
    case "running":
      return RUNNING;
    case "ok":
      return settled(isFiniteNumber(record.durationMs) ? quiet(formatDuration(record.durationMs)) : undefined);
  }
}
function outputLines(text) {
  return text.replace(HEADER, "").split(`
`).filter((line) => line.trim() !== "");
}
function scriptFailure(output) {
  const at = output.findIndex((line) => line.trim() === SCRIPT_ERROR);
  return firstActionableLine((at === -1 ? output : output.slice(at + 1)).join(`
`))?.replace(ERROR_PREFIX, "");
}
function answerOf(output, callCount, elapsedMs) {
  const only = shortAnswerLine(output.join(`
`), SHORT_ANSWER);
  if (only !== undefined)
    return { kind: "echo", line: only };
  const duration = elapsedMs === undefined ? undefined : formatDuration(elapsedMs);
  if (callCount > 0) {
    const calls = plural(callCount, "call", "calls");
    return { kind: "summary", text: duration === undefined ? calls : `${calls} · ${duration}` };
  }
  return { kind: "summary", text: output.length > 1 ? `${output.length} lines` : duration };
}
function clippedOutput(output) {
  return output.length > OUTPUT_LINES ? [...output.slice(0, OUTPUT_LINES), ELLIPSIS3] : output;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/edit-diff.ts
import { stripVTControlCharacters as stripVTControlCharacters3 } from "node:util";
import { getLanguageFromPath as getLanguageFromPath2, highlightCode as highlightCode2 } from "@earendil-works/pi-coding-agent";
import { sliceByColumn as sliceByColumn2, truncateToWidth as truncateToWidth5, visibleWidth as visibleWidth6, wrapTextWithAnsi as wrapTextWithAnsi2 } from "@earendil-works/pi-tui";
var HUNK = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
var ELLIPSIS4 = "…";
var INDENT2 = "  ";
var TAB3 = "   ";
function changeKind(marker) {
  switch (marker) {
    case "+":
      return "added";
    case "-":
      return "removed";
    case " ":
      return "context";
    default:
      return;
  }
}
function lineRange(start, count) {
  if (count === 0)
    return `after ${start}`;
  return count === 1 ? String(start) : `${start}–${start + count - 1}`;
}
function editDiff(patch) {
  const lines = [];
  const sections = [];
  let section;
  let added = 0;
  let removed = 0;
  let cursor;
  for (const raw of stripVTControlCharacters3(patch).replaceAll("\r", "").split(`
`)) {
    const hunk = HUNK.exec(raw);
    if (hunk !== null) {
      section = [];
      sections.push(section);
      cursor = { old: Number(hunk[1]), new: Number(hunk[3]) };
      const before = lineRange(cursor.old, Number(hunk[2] ?? 1));
      const after = lineRange(cursor.new, Number(hunk[4] ?? 1));
      lines.push({ kind: "hunk", text: `lines ${before} → ${after}` });
      continue;
    }
    const kind = changeKind(raw[0]);
    if (cursor === undefined || section === undefined || kind === undefined)
      continue;
    const entry = {
      kind,
      text: raw.slice(1).replaceAll("\t", TAB3),
      number: kind === "removed" ? cursor.old : cursor.new
    };
    section.push(entry);
    lines.push(entry);
    if (kind === "added")
      added += 1;
    if (kind === "removed")
      removed += 1;
    cursor = {
      old: cursor.old + (kind === "added" ? 0 : 1),
      new: cursor.new + (kind === "removed" ? 0 : 1)
    };
  }
  return { lines, sections, added, removed, hunks: sections.length };
}
function editSummary(diff) {
  if (diff.added === 0 && diff.removed === 0)
    return;
  const change = `+${diff.added} −${diff.removed}`;
  return diff.hunks > 1 ? `${change} · ${diff.hunks} hunks` : change;
}
function markerOf(line) {
  if (line.kind === "added")
    return "+";
  if (line.kind === "removed")
    return "−";
  return " ";
}
function colorOf(line) {
  if (line.kind === "added")
    return "toolDiffAdded";
  if (line.kind === "removed")
    return "toolDiffRemoved";
  return "toolDiffContext";
}
function highlightDiff(diff, path) {
  const language = path === undefined ? undefined : getLanguageFromPath2(path);
  const colors = new Map;
  for (const entries of diff.sections) {
    for (const excluded of ["added", "removed"]) {
      const side = entries.filter((entry) => entry.kind !== excluded);
      const colored = highlightCode2(side.map((entry) => entry.text).join(`
`), language);
      for (const [index, entry] of side.entries())
        colors.set(entry, colored[index] ?? entry.text);
    }
  }
  return colors;
}
function codeChunks(code, room) {
  const indent = /^ */.exec(stripVTControlCharacters3(code))?.[0] ?? "";
  const width = visibleWidth6(code);
  const hangs = width > room && indent.length > 0 && indent.length * 2 <= room;
  const body = hangs ? sliceByColumn2(code, indent.length, width - indent.length) : code;
  const bodyRoom = hangs ? room - indent.length : room;
  return wrapTextWithAnsi2(body, bodyRoom).map((chunk) => (hangs ? indent : "") + chunk);
}
function renderDiff(lines, width, palette, colors) {
  const gutter = lines.reduce((width, line) => line.kind === "hunk" ? width : Math.max(width, String(line.number).length), 1);
  return lines.flatMap((line) => {
    if (line.kind === "hunk") {
      return width <= INDENT2.length ? [] : [palette.fg("toolDiffContext", INDENT2 + truncateToWidth5(line.text, width - INDENT2.length, ELLIPSIS4))];
    }
    const prefix = INDENT2 + (markerOf(line) + String(line.number)).padStart(gutter + 1, " ") + " ";
    const room = width - visibleWidth6(prefix);
    if (room <= 0)
      return [];
    const chunks = codeChunks(colors.get(line) ?? line.text, room);
    const continued = " ".repeat(visibleWidth6(prefix));
    return chunks.map((chunk, index) => (index === 0 ? palette.fg(colorOf(line), prefix) : continued) + chunk);
  });
}
function diffLayout(diff, path, theme) {
  let colored;
  return widthCached((width) => {
    const palette = renderPalette(liveTheme() ?? theme);
    if (colored === undefined || colored.palette !== palette)
      colored = { palette, colors: highlightDiff(diff, path) };
    return renderDiff(diff.lines, width, theme, colored.colors);
  }, []);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/mcp-view.ts
import { Box, Container as Container4, Text } from "@earendil-works/pi-tui";
function mcpRenderers(label, pi, showsZen, now) {
  return selfShell(showsZen, (args, theme, context) => {
    if (!showsZen())
      return piCall(pi, args, theme, context) ?? nothing();
    startClock(context, now);
    return widthCached((width) => [formatToolRow({
      verb: "mcp",
      subject: { text: label, elide: "end" },
      outcome: RUNNING
    }, width, theme)], []);
  }, (result, options, theme, context) => {
    if (!showsZen())
      return piResult(pi, result, options, theme, context) ?? nothing();
    if (!options.isPartial)
      settleClock(rowMemory(context), now);
    const elapsed = elapsedOf(context);
    const row = {
      verb: "mcp",
      subject: { text: label, elide: "end" },
      outcome: context.isError ? { kind: "failed", reason: firstActionableLine(toolOutput(result.content).body) } : options.isPartial ? RUNNING : settled(elapsed === undefined ? undefined : quiet(formatDuration(elapsed)))
    };
    const heading = widthCached((width) => [formatToolRow(row, width, theme)], []);
    if (!context.expanded)
      return heading;
    const expanded = new Container4;
    expanded.addChild(heading);
    expanded.addChild(sourceLayout({ path: "arguments.json", text: JSON.stringify(context.args, null, 2) ?? "{}", startLine: 1 }, theme));
    const body = piResult(pi, result, options, theme, context) ?? new Text(theme.fg("toolOutput", toolOutput(result.content).body), 0, 0);
    const box = new Box(1, 0);
    box.addChild(body);
    expanded.addChild(box);
    return expanded;
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/row-preview.ts
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown as Markdown2, truncateToWidth as truncateToWidth6 } from "@earendil-works/pi-tui";
var MARKDOWN_PLACEMENT = { indent: "  ", whenEmpty: "(no visible content)" };
var SOURCE_PLACEMENT = { indent: "", whenEmpty: undefined };
function markdownBody(source, theme) {
  return new Markdown2(source, 0, 0, getMarkdownTheme(), { color: (text) => theme.fg("toolOutput", text) }, {
    renderLatex: false
  });
}
function placed(body, theme) {
  switch (body.kind) {
    case "markdown":
      return { content: markdownBody(body.text, theme), placement: MARKDOWN_PLACEMENT };
    case "source":
      return { content: sourceLayout(body.file, theme), placement: SOURCE_PLACEMENT };
  }
}
function layout(row, { content, placement }, theme, width) {
  const head = formatToolRow(row, width, theme);
  const room = width - placement.indent.length;
  if (room <= 0)
    return [head];
  const lines = content.render(room);
  if (lines.length > 0)
    return [head, "", ...lines.map((line) => placement.indent + line)];
  if (placement.whenEmpty === undefined)
    return [head];
  return [head, "", placement.indent + theme.fg("dim", truncateToWidth6(placement.whenEmpty, room, "…"))];
}
function rowPreview(row, body, theme) {
  const shown = placed(body, theme);
  return widthCached((width) => layout(row, shown, theme, width), [shown.content]);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/tool-views.ts
var STREAMING_TAIL_LINES = 10;
var MORE_LINES = /^(\d+) more lines in file\b/;
var MARKDOWN_PATH = /\.(?:md|markdown)$/i;
function rowComponent(row, diff, palette) {
  return widthCached((width) => {
    const head = formatToolRow(row, width, palette);
    return diff === undefined ? [head] : [head, ...diff.render(width)];
  }, diff === undefined ? [] : [diff]);
}
function streamingTail(output, theme) {
  const tail = output.body.split(`
`).filter((line) => line.trim() !== "").slice(-STREAMING_TAIL_LINES);
  if (tail.length === 0)
    return nothing();
  return new Text2(tail.map((line) => theme.fg("dim", line)).join(`
`), 2, 0);
}
function stacked(top, bottom) {
  const stack = new Container5;
  stack.addChild(top);
  stack.addChild(bottom);
  return stack;
}
function boxed(component) {
  const box = new Box2(1, 0);
  box.addChild(component);
  return box;
}
function settledOf(call, result, context) {
  const details = toolDetails(result.details);
  const patch = reportedPatch(details);
  return {
    call,
    output: toolOutput(result.content),
    details,
    diff: patch === undefined ? undefined : editDiff(patch),
    elapsedMs: elapsedOf(context)
  };
}
function outputBody(output, theme) {
  const body = output.body === "" ? nothing() : new Text2(theme.fg("toolOutput", output.body), 2, 0);
  return output.notice === undefined ? body : stacked(body, new Text2(theme.fg("warning", output.notice), 2, 0));
}
function viewRenderers(tool, spec) {
  return (pi, showsZen, now) => {
    const results = new WeakMap;
    const expandedResult = (row, shown, piView, theme, input) => {
      if (tool === "edit" && row.outcome.kind !== "failed" && shown.diff !== undefined) {
        return rowComponent(row, diffLayout(shown.diff, readSpan(input).path, theme), theme);
      }
      const head = rowComponent(row, undefined, theme);
      if (tool === "bash" || tool === "powershell") {
        const command = isString(input.command) ? input.command : "";
        const source = sourceLayout({ path: tool === "bash" ? "command.sh" : "command.ps1", text: command, startLine: 1 }, theme);
        const metadata = isFiniteNumber(input.timeout) && input.timeout > 0 ? stacked(head, new Text2(theme.fg("dim", `timeout ${input.timeout}s`), 2, 0)) : head;
        return stacked(stacked(metadata, source), outputBody(shown.output, theme));
      }
      if (row.outcome.kind === "failed")
        return stacked(head, outputBody(shown.output, theme));
      const preview = spec.preview;
      const target = preview?.target(shown.call);
      const text = target === undefined ? undefined : preview?.text(shown);
      if (target !== undefined && text !== undefined)
        return rowPreview(row, previewBody(target, text), theme);
      const own = piView();
      const framed = own === undefined ? nothing() : boxed(own);
      if (target === undefined && tool !== "edit")
        return framed;
      return stacked(rowComponent(row, undefined, theme), framed);
    };
    return selfShell(showsZen, (args, theme, context) => {
      if (!showsZen())
        return piCall(pi, args, theme, context) ?? nothing();
      const memory = rowMemory(context);
      memory.expanded = context.expanded;
      startClock(context, now);
      const input = toolInput(args);
      if (context.isPartial) {
        const row = { ...headingOf(tool, input, context.cwd), outcome: RUNNING };
        return rowComponent(row, undefined, theme);
      }
      if (!context.expanded || context.isError || tool === "bash" || tool === "powershell")
        return nothing();
      if (tool === "edit" || spec.preview?.target(spec.call(input)) !== undefined)
        return nothing();
      return piCall(pi, args, theme, context) ?? nothing();
    }, (result, options, theme, context) => {
      if (!showsZen())
        return piResult(pi, result, options, theme, context) ?? nothing();
      quietLiveTheme();
      if (options.isPartial) {
        const row = { ...headingOf(tool, toolInput(context.args), context.cwd), outcome: RUNNING };
        const head = rowComponent(row, undefined, theme);
        return context.expanded ? stacked(head, streamingTail(toolOutput(result.content), theme)) : head;
      }
      const memory = rowMemory(context);
      memory.expanded = context.expanded;
      settleClock(memory, now);
      const input = toolInput(context.args);
      const palette = renderPalette(theme);
      let cached = results.get(memory);
      if (cached === undefined || cached.args !== context.args || cached.content !== result.content || cached.details !== result.details || cached.error !== context.isError || cached.images !== context.showImages || cached.cwd !== context.cwd) {
        cached = {
          args: context.args,
          content: result.content,
          details: result.details,
          error: context.isError,
          images: context.showImages,
          cwd: context.cwd,
          shown: settledOf(spec.call(input), result, context),
          palette,
          compact: undefined,
          expanded: undefined
        };
        results.set(memory, cached);
      }
      if (cached.palette !== palette) {
        cached.palette = palette;
        cached.compact = undefined;
        cached.expanded = undefined;
      }
      const shown = cached.shown;
      const outcome = context.isError ? { kind: "failed", reason: spec.failure(shown.output) } : settled(spec.detail(shown));
      const row = { ...headingOf(tool, input, context.cwd), outcome };
      if (context.expanded) {
        cached.expanded ??= expandedResult(row, shown, () => piResult(pi, result, options, theme, context), theme, input);
        return cached.expanded;
      }
      cached.compact ??= rowComponent(row, undefined, theme);
      return cached.compact;
    });
  };
}
function counted(summary, details) {
  if (reachedLimit(details))
    return attention(`${summary} · limit`);
  if (isTruncated(details))
    return attention(`${summary} · truncated`);
  return quiet(summary);
}
function withTruncation(parts, details) {
  if (isTruncated(details))
    return attention([...parts, "truncated"].join(" · "));
  return parts.length === 0 ? undefined : quiet(parts.join(" · "));
}
function previewTarget(path) {
  if (MARKDOWN_PATH.test(path))
    return { kind: "markdown", path };
  return getLanguageFromPath3(path) === undefined ? undefined : { kind: "source", path };
}
function readsWholeFile(span) {
  return (span.offset === undefined || span.offset === 1) && span.limit === undefined;
}
function readPreviewTarget(span) {
  if (span.path === undefined)
    return;
  const target = previewTarget(span.path);
  return target?.kind === "markdown" && !readsWholeFile(span) ? undefined : target;
}
function previewBody(target, { text, startLine }) {
  return target.kind === "markdown" ? { kind: "markdown", text } : { kind: "source", file: { path: target.path, text, startLine } };
}
function ignoredInput() {
  return;
}
function firstLineOf(output) {
  return firstActionableLine(output.body);
}
var READ = {
  call: readSpan,
  detail: ({ call, output, details }) => {
    if (output.image)
      return quiet("image");
    const more = output.notice === undefined ? undefined : MORE_LINES.exec(output.notice)?.[1];
    const parts = [
      ...call.offset === undefined ? [] : [`from ${call.offset}`],
      ...more === undefined ? [] : [`${more} more`]
    ];
    return withTruncation(parts, details);
  },
  failure: firstLineOf,
  preview: {
    target: readPreviewTarget,
    text: ({ call, output, details }) => output.image || isTruncated(details) ? undefined : { text: output.body, startLine: call.offset ?? 1 }
  }
};
var RUN = {
  call: ignoredInput,
  detail: ({ output, details, elapsedMs }) => {
    const answer = shortOutputLine(output);
    const parts = [
      ...answer === undefined ? [] : [answer],
      ...elapsedMs === undefined ? [] : [formatDuration(elapsedMs)]
    ];
    return withTruncation(parts, details);
  },
  failure: (output) => bashFailureSummary(output.body),
  preview: undefined
};
var EDIT = {
  call: ignoredInput,
  detail: ({ diff }) => {
    const summary = diff === undefined ? undefined : editSummary(diff);
    return summary === undefined ? undefined : quiet(summary);
  },
  failure: firstLineOf,
  preview: undefined
};
var WRITE = {
  call: writtenFile,
  detail: ({ call }) => quiet(plural(countFileLines(call.content), "line", "lines")),
  failure: firstLineOf,
  preview: {
    target: (call) => call.path === undefined ? undefined : previewTarget(call.path),
    text: ({ call }) => ({ text: call.content, startLine: 1 })
  }
};
var GREP = {
  call: ignoredInput,
  detail: ({ output, details }) => counted(plural(countMatches(output.body), "match", "matches"), details),
  failure: firstLineOf,
  preview: undefined
};
var FIND = {
  call: ignoredInput,
  detail: ({ output, details }) => counted(plural(countListed(output.body), "file", "files"), details),
  failure: firstLineOf,
  preview: undefined
};
var LIST = {
  call: ignoredInput,
  detail: ({ output, details }) => counted(plural(countListed(output.body), "entry", "entries"), details),
  failure: firstLineOf,
  preview: undefined
};
var TOOL_VIEWS = {
  read: viewRenderers("read", READ),
  bash: viewRenderers("bash", RUN),
  powershell: viewRenderers("powershell", RUN),
  edit: viewRenderers("edit", EDIT),
  write: viewRenderers("write", WRITE),
  grep: viewRenderers("grep", GREP),
  find: viewRenderers("find", FIND),
  ls: viewRenderers("ls", LIST)
};
function registerToolViews(pi, runs, showsZen, now) {
  pi.registerToolRenderer((toolName, next) => {
    if (toolName === CODEMODE)
      return groupedRenderers(toolName, codemodeRenderers(next(), showsZen, now), runs, showsZen, codemodeFailures);
    const mcp = mcpToolName(toolName);
    if (mcp !== undefined)
      return groupedRenderers(toolName, mcpRenderers(mcp, next(), showsZen, now), runs, showsZen);
    const tool = builtInTool(toolName);
    if (tool === undefined) {
      if (showsZen())
        runs.close();
      return next();
    }
    return groupedRenderers(toolName, TOOL_VIEWS[tool](next(), showsZen, now), runs, showsZen);
  });
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/turn-timing.ts
import { truncateToWidth as truncateToWidth7, visibleWidth as visibleWidth7 } from "@earendil-works/pi-tui";
function phaseFromContent(blocks) {
  const latest = blocks.at(-1);
  if (latest === undefined)
    return;
  return latest.type === "thinking" ? "thinking" : "writing";
}
var SEPARATOR = " · ";
var ELLIPSIS5 = "…";
var LEGIBLE_MS = 50;
var NO_TOKENS = { input: 0, output: 0 };
function formatSeconds(ms) {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}
function formatTokenCount(count) {
  if (count < 1000)
    return String(Math.max(0, Math.round(count)));
  if (count < 1e4)
    return `${(count / 1000).toFixed(1)}k`;
  if (count < 1e6)
    return `${Math.round(count / 1000)}k`;
  if (count < 1e7)
    return `${(count / 1e6).toFixed(1)}M`;
  return `${Math.round(count / 1e6)}M`;
}
function addTokens(left, right) {
  return { input: left.input + right.input, output: left.output + right.output };
}
function accrue(timing, now) {
  const totals = { thinkingMs: timing.thinkingMs, writingMs: timing.writingMs, committed: timing.committed };
  if (timing.kind === "idle")
    return totals;
  const spent = Math.max(0, now - (timing.kind === "waiting" ? timing.openedAt : timing.since));
  const phase = timing.kind === "waiting" ? "thinking" : timing.phase;
  return phase === "thinking" ? { ...totals, thinkingMs: totals.thinkingMs + spent } : { ...totals, writingMs: totals.writingMs + spent };
}
function elapsed(timing, now) {
  const totals = accrue(timing, now);
  return { thinkingMs: totals.thinkingMs, writingMs: totals.writingMs };
}
function tokens(timing) {
  return timing.kind === "idle" ? timing.committed : addTokens(timing.committed, timing.live);
}
function statusSegments(timing, now) {
  const spent = elapsed(timing, now);
  const used = tokens(timing);
  const segments = [];
  if (spent.thinkingMs >= LEGIBLE_MS)
    segments.push(`${formatSeconds(spent.thinkingMs)} reasoning / waiting`);
  if (spent.writingMs >= LEGIBLE_MS)
    segments.push(`${formatSeconds(spent.writingMs)} writing`);
  if (used.input > 0 || used.output > 0) {
    segments.push(`↑${formatTokenCount(used.input)} ↓${formatTokenCount(used.output)}`);
  }
  return segments;
}
function fitToWidth(segments, width) {
  let kept = segments.length;
  while (kept > 1 && visibleWidth7(segments.slice(0, kept).join(SEPARATOR)) > width)
    kept -= 1;
  const body = segments.slice(0, kept).join(SEPARATOR);
  return visibleWidth7(body) <= width ? body : truncateToWidth7(body, width, ELLIPSIS5);
}
function beginRun() {
  return { kind: "idle", thinkingMs: 0, writingMs: 0, committed: NO_TOKENS };
}
function advance(timing, signal, now) {
  switch (signal.kind) {
    case "opened":
      return { kind: "waiting", openedAt: now, live: NO_TOKENS, ...accrue(timing, now) };
    case "producing": {
      if (timing.kind === "streaming" && timing.phase === signal.phase)
        return { ...timing, live: signal.live };
      return {
        kind: "streaming",
        phase: signal.phase,
        since: now,
        live: signal.live,
        ...accrue(timing, now)
      };
    }
    case "committed": {
      const totals = accrue(timing, now);
      return { kind: "idle", ...totals, committed: addTokens(totals.committed, signal.tokens) };
    }
    case "closed":
      return { kind: "idle", ...accrue(timing, now) };
  }
}
function formatTurnStatus(timing, now, width) {
  if (width <= 0)
    return "";
  const segments = statusSegments(timing, now);
  return segments.length === 0 ? "" : fitToWidth(segments, width);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/turn-status.ts
var WIDGET_KEY2 = "zen-turn-status";
var PADDING = " ";
var TICK_MS = 240;
function tokensOf(usage) {
  return { input: usage.input, output: usage.output };
}
function statusLines(line, theme) {
  return line === "" ? [] : [PADDING + theme.fg("muted", line)];
}
function createTurnStatus(now) {
  let shownOn;
  let timing = beginRun();
  let ticker;
  let screen;
  const refresh = () => screen?.requestRender();
  const stopTicking = () => {
    if (ticker === undefined)
      return;
    clearInterval(ticker);
    ticker = undefined;
  };
  const startTicking = () => {
    stopTicking();
    ticker = setInterval(refresh, TICK_MS);
    ticker.unref();
  };
  const apply = (signal) => {
    if (shownOn === undefined)
      return;
    timing = advance(timing, signal, now());
    refresh();
  };
  const widget = (tui, theme) => {
    screen = tui;
    return {
      render: (width) => statusLines(formatTurnStatus(timing, now(), width - PADDING.length * 2), theme),
      invalidate: () => {},
      dispose: () => {
        if (screen === tui)
          screen = undefined;
      }
    };
  };
  return {
    show: (ui) => {
      shownOn = ui;
      ui.setWidget(WIDGET_KEY2, widget);
    },
    hide: (ui) => {
      shownOn = undefined;
      stopTicking();
      timing = beginRun();
      ui.setWidget(WIDGET_KEY2, undefined);
    },
    begin: () => {
      if (shownOn === undefined)
        return;
      timing = beginRun();
      startTicking();
      refresh();
    },
    open: () => apply({ kind: "opened" }),
    produce: (phase, usage) => apply({ kind: "producing", phase, live: tokensOf(usage) }),
    commit: (usage) => apply({ kind: "committed", tokens: tokensOf(usage) }),
    end: () => {
      apply({ kind: "closed" });
      stopTicking();
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/work-activity.ts
var SILENCE_MS = 1e4;
function startingActivity(now) {
  return { model: "waiting", lastOutputAt: now, tools: [] };
}
function activityFromUpdate(event) {
  switch (event.type) {
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end": {
      const block = event.partial.content[event.contentIndex];
      if (block?.type !== "thinking")
        return;
      return block.redacted || event.type === "thinking_end" && block.thinking.trim() === "" ? "reasoning-unavailable" : "reasoning";
    }
    case "text_start":
    case "text_delta":
    case "text_end":
    case "toolcall_start":
    case "toolcall_delta":
    case "toolcall_end":
      return "writing";
    default:
      return;
  }
}
function withModel(activity, model, now) {
  return { ...activity, model, lastOutputAt: now };
}
function withoutTool(activity, id, now) {
  const tools = activity.tools.filter((tool) => tool.id !== id);
  return tools.length === 0 && activity.tools.length > 0 ? { model: "waiting", lastOutputAt: now, tools } : { ...activity, tools };
}
function withTool(activity, id, label, now, parentId) {
  const startedAt = activity.tools.find((tool) => tool.id === id)?.startedAt ?? now;
  return { ...activity, tools: [...activity.tools.filter((tool) => tool.id !== id), { id, label, startedAt, parentId }] };
}
function activityPhrase(activity, now) {
  if (activity.tools.length === 0) {
    const silence = Math.max(0, now - activity.lastOutputAt);
    if (silence >= SILENCE_MS)
      return `waiting for response · no model output for ${Math.floor(silence / 1000)}s`;
    switch (activity.model) {
      case "waiting":
        return "waiting for response";
      case "reasoning":
        return "reasoning";
      case "reasoning-unavailable":
        return "reasoning · text unavailable";
      case "writing":
        return "writing";
    }
  }
  const parents = new Set(activity.tools.map((tool) => tool.parentId));
  const running = activity.tools.filter((tool) => !parents.has(tool.id));
  const active = running.at(-1);
  if (active === undefined)
    return "waiting for response";
  const seconds = Math.floor(Math.max(0, now - active.startedAt) / 1000);
  const others = running.length - 1;
  return `${active.label} · ${seconds}s${others > 0 ? ` · +${others} running` : ""}`;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/work-status.ts
function createWorkStatus(now) {
  let shownOn;
  let activity;
  let previousPhrase;
  let ticker;
  const stopTicking = () => {
    if (ticker === undefined)
      return;
    clearInterval(ticker);
    ticker = undefined;
  };
  const refresh = () => {
    if (shownOn === undefined || activity === undefined)
      return;
    const phrase = activityPhrase(activity, now());
    if (previousPhrase !== phrase)
      shownOn.setWorkingMessage(shownOn.theme.fg("muted", phrase));
    previousPhrase = phrase;
  };
  const startTicking = () => {
    if (shownOn === undefined || activity === undefined || ticker !== undefined)
      return;
    ticker = setInterval(refresh, 1000);
    ticker.unref();
  };
  const work = (next) => {
    if (activity === undefined)
      return;
    activity = next(activity);
    refresh();
  };
  return {
    show: (ui) => {
      shownOn = ui;
      previousPhrase = undefined;
      refresh();
      startTicking();
    },
    hide: (ui) => {
      stopTicking();
      shownOn = undefined;
      previousPhrase = undefined;
      ui.setWorkingMessage();
    },
    begin: () => {
      stopTicking();
      activity = startingActivity(now());
      previousPhrase = undefined;
      refresh();
      startTicking();
    },
    model: (model) => work((current) => withModel(current, model, now())),
    toolStarted: (id, label, parentId) => work((current) => withTool(current, id, label, now(), parentId)),
    toolEnded: (id) => work((current) => withoutTool(current, id, now())),
    end: () => {
      stopTicking();
      activity = undefined;
      previousPhrase = undefined;
      shownOn?.setWorkingMessage();
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/zen-column.ts
import { Container as Container6 } from "@earendil-works/pi-tui";
var MIN_TEXT_WIDTH = 80;
var MAX_SIDE_MARGIN_RATIO = 0.2;
var WIDGET_KEY3 = "zen-column";
var OSC133_PREFIX = /^((?:\x1b\]133;[ABC](?:\x07|\x1b\\))+)/;
function computeZenColumn(width) {
  const safeWidth = Math.max(1, Math.floor(width));
  if (safeWidth <= MIN_TEXT_WIDTH) {
    return { leftMargin: 0, rightMargin: 0, contentWidth: safeWidth };
  }
  const maxMarginByRatio = Math.floor(safeWidth * MAX_SIDE_MARGIN_RATIO);
  const maxMarginByMinText = Math.floor((safeWidth - MIN_TEXT_WIDTH) / 2);
  const sideMargin = Math.max(0, Math.min(maxMarginByRatio, maxMarginByMinText));
  const contentWidth = safeWidth - sideMargin * 2;
  return {
    leftMargin: sideMargin,
    rightMargin: sideMargin,
    contentWidth
  };
}
function padZenLine(line, leftMargin) {
  if (leftMargin <= 0 || line === "")
    return line;
  const pad = " ".repeat(leftMargin);
  const match = OSC133_PREFIX.exec(line);
  if (match !== null) {
    const prefix = match[1] ?? "";
    const rest = line.slice(prefix.length);
    return rest === "" ? line : `${prefix}${pad}${rest}`;
  }
  return `${pad}${line}`;
}
function wrapRootComponent(component) {
  const originalRender = component.render;
  const originalHandleMouse = component.handleMouse;
  const originalInvalidate = component.invalidate;
  let cachedWidth;
  let cachedInnerLines;
  let cachedOutLines;
  const wrappedRender = function(width) {
    const { leftMargin, contentWidth } = computeZenColumn(width);
    if (leftMargin <= 0) {
      return originalRender.call(this, width);
    }
    const innerLines = originalRender.call(this, contentWidth);
    if (cachedOutLines !== undefined && cachedWidth === width && cachedInnerLines === innerLines) {
      return cachedOutLines;
    }
    const out = innerLines.map((line) => padZenLine(line, leftMargin));
    cachedWidth = width;
    cachedInnerLines = innerLines;
    cachedOutLines = out;
    return out;
  };
  const wrappedHandleMouse = function(event) {
    if (typeof originalHandleMouse !== "function")
      return;
    const { leftMargin, contentWidth } = computeZenColumn(event.width);
    if (leftMargin <= 0) {
      return originalHandleMouse.call(this, event);
    }
    const localX = event.x - leftMargin;
    if (localX < 0 || localX >= contentWidth) {
      return;
    }
    return originalHandleMouse.call(this, {
      ...event,
      x: localX,
      width: contentWidth
    });
  };
  const wrappedInvalidate = function() {
    cachedWidth = undefined;
    cachedInnerLines = undefined;
    cachedOutLines = undefined;
    originalInvalidate.call(this);
  };
  component.render = wrappedRender;
  if (typeof originalHandleMouse === "function") {
    component.handleMouse = wrappedHandleMouse;
  }
  component.invalidate = wrappedInvalidate;
  return {
    restore: () => {
      if (component.render === wrappedRender)
        component.render = originalRender;
      if (component.handleMouse === wrappedHandleMouse)
        component.handleMouse = originalHandleMouse;
      if (component.invalidate === wrappedInvalidate)
        component.invalidate = originalInvalidate;
    }
  };
}
function wrapHiddenResources(component) {
  const originalRender = component.render;
  const originalHandleMouse = component.handleMouse;
  const emptyRender = () => [];
  const emptyMouse = () => {
    return;
  };
  component.render = emptyRender;
  if (typeof originalHandleMouse === "function") {
    component.handleMouse = emptyMouse;
  }
  return {
    restore: () => {
      if (component.render === emptyRender)
        component.render = originalRender;
      if (component.handleMouse === emptyMouse)
        component.handleMouse = originalHandleMouse;
    }
  };
}
function mountZenColumn(tui) {
  const wrappedRoots = new Map;
  let wrappedResources;
  const previousRequestRender = tui.requestRender;
  let active = true;
  const syncWrappedChildren = () => {
    if (!active)
      return;
    for (const child of tui.children) {
      if (!wrappedRoots.has(child)) {
        wrappedRoots.set(child, wrapRootComponent(child));
      }
    }
    const documentContainer = tui.children[0];
    if (documentContainer instanceof Container6 && documentContainer.children.length >= 3) {
      const loadedResources = documentContainer.children[1];
      if (loadedResources !== undefined && wrappedResources?.target !== loadedResources) {
        wrappedResources?.wrapper.restore();
        wrappedResources = {
          target: loadedResources,
          wrapper: wrapHiddenResources(loadedResources)
        };
      }
    }
  };
  const invalidateAll = () => {
    for (const child of tui.children) {
      child.invalidate();
    }
    tui.invalidate();
  };
  const requestRender = (force) => {
    syncWrappedChildren();
    previousRequestRender.call(tui, force);
  };
  const dispose = () => {
    if (!active)
      return;
    active = false;
    if (tui.requestRender === requestRender) {
      tui.requestRender = previousRequestRender;
    }
    wrappedResources?.wrapper.restore();
    wrappedResources = undefined;
    for (const wrapper of wrappedRoots.values()) {
      wrapper.restore();
    }
    wrappedRoots.clear();
    invalidateAll();
    previousRequestRender.call(tui, true);
  };
  syncWrappedChildren();
  tui.requestRender = requestRender;
  invalidateAll();
  requestRender(true);
  return { dispose };
}
function createZenColumn() {
  let mounted;
  return {
    show: (ui) => {
      if (mounted !== undefined)
        return;
      ui.setWidget(WIDGET_KEY3, (tui) => {
        const mount = mountZenColumn(tui);
        mounted = mount;
        return {
          render: () => [],
          invalidate: () => {},
          dispose: () => {
            mount.dispose();
            if (mounted === mount)
              mounted = undefined;
          }
        };
      });
    },
    hide: (ui) => {
      mounted?.dispose();
      mounted = undefined;
      ui.setWidget(WIDGET_KEY3, undefined);
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/zen-editor.ts
import { CustomEditor } from "@earendil-works/pi-coding-agent";

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/editor-rail.ts
import { stripTerminalSequences as stripTerminalSequences2 } from "@earendil-works/pi-tui";
var RAIL_GLYPH = "┃";
var MIN_RAIL_PADDING = 2;
function isFrameRow(row) {
  return stripTerminalSequences2(row).startsWith("─");
}
function carriesScrollHint(row) {
  const plain = stripTerminalSequences2(row);
  return plain.includes("↑") || plain.includes("↓");
}
function railBodyRow(row, paddingX, paint) {
  const indent = " ".repeat(paddingX);
  if (!row.startsWith(indent))
    return row;
  return paint(RAIL_GLYPH) + " ".repeat(paddingX - 1) + row.slice(paddingX);
}
function applyRail(rows, paddingX, paint) {
  if (paddingX < MIN_RAIL_PADDING || rows.length < 2)
    return [...rows];
  const frames = [];
  for (const [index, row] of rows.entries()) {
    if (isFrameRow(row))
      frames.push(index);
  }
  const top = frames.at(0);
  const bottom = frames.at(-1);
  if (top !== 0 || bottom === undefined || bottom <= top)
    return [...rows];
  const railed = [];
  for (const [index, row] of rows.entries()) {
    if (index === top || index === bottom) {
      if (carriesScrollHint(row))
        railed.push(row);
      continue;
    }
    railed.push(index > bottom ? row : railBodyRow(row, paddingX, paint));
  }
  return railed;
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/zen-editor.ts
function createZenEditor(tui, theme, keybindings, history, previous) {
  const candidate = previous?.(tui, theme, keybindings);
  const editor = candidate instanceof CustomEditor ? candidate : new CustomEditor(tui, theme, keybindings, { paddingX: MIN_RAIL_PADDING });
  const addToHistory = editor.addToHistory.bind(editor);
  const setPaddingX = editor.setPaddingX.bind(editor);
  const render = editor.render.bind(editor);
  setPaddingX(Math.max(MIN_RAIL_PADDING, editor.getPaddingX()));
  history.replay(addToHistory);
  return Object.assign(editor, {
    embedWorkingStatus: false,
    addToHistory: (text) => {
      addToHistory(text);
      history.remember(text);
    },
    setPaddingX: (padding) => setPaddingX(Math.max(MIN_RAIL_PADDING, padding)),
    render: (width) => applyRail(render(width), editor.getPaddingX(), (glyph) => editor.borderColor(glyph))
  });
}
function zenEditorPart(history) {
  let replaced;
  return {
    show: (ui) => {
      const previous = replaced?.previous ?? ui.getEditorComponent();
      replaced ??= { previous };
      ui.setEditorComponent((tui, theme, keybindings) => createZenEditor(tui, theme, keybindings, history, previous));
    },
    hide: (ui) => {
      if (replaced === undefined)
        return;
      ui.setEditorComponent(replaced.previous);
      replaced = undefined;
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/ui-claim.ts
function createUiClaim(parts) {
  let claimed;
  const release = () => {
    const ui = claimed;
    if (ui === undefined)
      return;
    claimed = undefined;
    for (const part of [...parts].reverse())
      part.hide(ui);
  };
  return {
    claim: (ui) => {
      if (claimed !== ui)
        release();
      claimed = ui;
      for (const part of parts)
        part.show(ui);
    },
    release
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/zen-switch.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var CONFIG_FILE = "pi-zen.json";
var CHOICES = new Map([
  ["on", "zen"],
  ["off", "pi"],
  ["details", "zen-details"]
]);
var DEFAULT_CHOICES = new Map([
  ["default", "toggle"],
  ["default on", "on"],
  ["default off", "off"]
]);
var TOP_COMPLETIONS = ["on", "off", "details", "default"];
var DEFAULT_COMPLETIONS = ["default", "default on", "default off"];
var USAGE_NOTICE = { text: "Usage: /zen [on|off|details|default [on|off]]", level: "warning" };
var ON_OUTSIDE_TUI = { text: "Zen on · it shows in Pi's interactive terminal", level: "info" };
function parseZenCommand(args) {
  const argument = args.trim().toLowerCase().replace(/\s+/g, " ");
  if (argument === "")
    return { _tag: "Command", command: { _tag: "Toggle" } };
  const defaultMode = DEFAULT_CHOICES.get(argument);
  if (defaultMode !== undefined) {
    return { _tag: "Command", command: { _tag: "Default", mode: defaultMode } };
  }
  const look = CHOICES.get(argument);
  return look === undefined ? { _tag: "Unrecognized", argument } : { _tag: "Command", command: { _tag: "Choose", look } };
}
function zenCompletions(prefix) {
  const normalized = prefix.trimStart().toLowerCase().replace(/\s+/g, " ");
  const candidates = normalized.startsWith("default") ? DEFAULT_COMPLETIONS : TOP_COMPLETIONS;
  return candidates.filter((word) => word.startsWith(normalized)).map((word) => ({ value: word, label: word }));
}
function lookAfter(command, current) {
  switch (command._tag) {
    case "Toggle":
      return current === "pi" ? "zen" : "pi";
    case "Choose":
      return command.look;
  }
}
function readConfigObject(path) {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function readZenDefault(agentDir) {
  const config = readConfigObject(join(agentDir, CONFIG_FILE));
  return config.defaultEnabled === true;
}
function writeZenDefault(agentDir, enabled) {
  const path = join(agentDir, CONFIG_FILE);
  try {
    const existing = readConfigObject(path);
    const updated = { ...existing, defaultEnabled: enabled };
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}
`, "utf8");
    return { ok: true, enabled };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, enabled, path, detail };
  }
}
function carriedSwitch(agentDir) {
  const initialLook = agentDir !== undefined && readZenDefault(agentDir) ? "zen" : "pi";
  const carried = globalThis.piZenSwitch ?? { look: initialLook };
  globalThis.piZenSwitch = carried;
  const isDefault = () => agentDir === undefined ? false : readZenDefault(agentDir);
  return {
    look: () => carried.look,
    turn: (command) => {
      carried.look = lookAfter(command, carried.look);
      return carried.look;
    },
    isDefault,
    turnDefault: (mode) => {
      const nextEnabled = mode === "on" ? true : mode === "off" ? false : !isDefault();
      carried.look = nextEnabled ? "zen" : "pi";
      if (agentDir === undefined) {
        return { ok: true, enabled: nextEnabled };
      }
      return writeZenDefault(agentDir, nextEnabled);
    }
  };
}
function isZenActive() {
  return (globalThis.piZenSwitch?.look ?? "pi") !== "pi";
}
function failedAction(failure) {
  switch (failure._tag) {
    case "SettingsUnreadable":
    case "ZenRecordUnreadable":
      return "read";
    case "SettingsUnwritable":
    case "ZenRecordUnwritable":
      return "write";
  }
}
function failureText(failure) {
  return `could not ${failedAction(failure)} ${failure.path} (${failure.detail})`;
}
function headOnly(head) {
  return { text: head, level: "info" };
}
function headed(head, detail) {
  return { text: `${head} · ${detail.text}`, level: detail.level };
}
function startupNotice(outcome) {
  switch (outcome._tag) {
    case "Quieted":
      return {
        text: "Zen turned on quietStartup in Pi's settings, so Pi starts quietly from the next launch. /zen off turns it back off.",
        level: "info"
      };
    case "Failed":
      return { text: `Zen left quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" };
    case "QuietedUnrecorded":
      return {
        text: `Zen turned on quietStartup in Pi's settings but ${failureText(outcome.failure)}, so /zen off will not turn it back off.`,
        level: "warning"
      };
    case "AlreadyQuiet":
    case "LeftToUser":
      return;
  }
}
function onNotice(outcome) {
  switch (outcome._tag) {
    case "Quieted":
      return headed("Zen on", { text: "quiet startup from the next launch", level: "info" });
    case "QuietedUnrecorded":
      return headed("Zen on", {
        text: `quiet startup from the next launch, but ${failureText(outcome.failure)}, so /zen off will leave it on`,
        level: "warning"
      });
    case "Failed":
      return headed("Zen on", { text: `quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" });
    case "AlreadyQuiet":
    case "LeftToUser":
      return headOnly("Zen on");
  }
}
function offNotice(outcome) {
  switch (outcome._tag) {
    case "Restored":
      return headed("Zen off", { text: "Pi's startup screen returns from the next launch", level: "info" });
    case "RestoredUnrecorded":
      return headed("Zen off", {
        text: `Pi's startup screen returns from the next launch, but ${failureText(outcome.failure)}`,
        level: "warning"
      });
    case "Failed":
      return headed("Zen off", {
        text: `quietStartup not restored: ${failureText(outcome.failure)}`,
        level: "warning"
      });
    case "NothingToRestore":
      return headOnly("Zen off");
  }
}
function defaultNotice(outcome) {
  const head = outcome.enabled ? "Zen default on" : "Zen default off";
  if (!outcome.ok) {
    return headed(head, {
      text: `could not write ${outcome.path} (${outcome.detail})`,
      level: "warning"
    });
  }
  return headed(head, {
    text: outcome.enabled ? "Zen enabled by default on startup" : "Zen disabled by default on startup",
    level: "info"
  });
}
function announce(ui, notice) {
  ui.notify(notice.text, notice.level);
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/src/zen-lifecycle.ts
function createZenLifecycle({
  zenSwitch,
  history,
  startup,
  parts,
  onBeforeEnter,
  onAfterLeave
}) {
  const zenUi = createUiClaim(parts);
  const enter = (host, occasion) => {
    onBeforeEnter?.(host);
    history.seed(host.sessionManager, occasion);
    zenUi.claim(host.ui);
    return startup.quiet(host.cwd);
  };
  const leave = (host) => {
    zenUi.release();
    onAfterLeave?.(host);
    return startup.restore(host.cwd);
  };
  return {
    sessionStarted: async (reason, host) => {
      if (host.mode !== "tui" || zenSwitch.look() === "pi")
        return;
      const notice = startupNotice(await enter(host, reason));
      if (notice !== undefined)
        announce(host.ui, notice);
    },
    sessionEnded: () => zenUi.release(),
    command: async (args, host) => {
      const parsed = parseZenCommand(args);
      if (parsed._tag === "Unrecognized") {
        announce(host.ui, USAGE_NOTICE);
        return;
      }
      if (parsed.command._tag === "Default") {
        const outcome = zenSwitch.turnDefault(parsed.command.mode);
        if (!outcome.enabled) {
          await leave(host);
        } else if (host.mode === "tui") {
          await enter(host, "zen on");
        }
        announce(host.ui, defaultNotice(outcome));
        return;
      }
      if (zenSwitch.turn(parsed.command) === "pi") {
        announce(host.ui, offNotice(await leave(host)));
        return;
      }
      if (host.mode !== "tui") {
        announce(host.ui, ON_OUTSIDE_TUI);
        return;
      }
      announce(host.ui, onNotice(await enter(host, "zen on")));
    }
  };
}

// dotfiles/stow_modules/main/dot-pi/agent/extensions/zen/index.ts
function zen(pi) {
  const zenSwitch = carriedSwitch(getAgentDir());
  let sessionManager;
  const runs = createCallRuns(() => {
    if (sessionManager !== undefined)
      seedRuns(sessionManager);
  });
  const history = carriedPromptHistory();
  const turnStatus = createTurnStatus(Date.now);
  const workStatus = createWorkStatus(() => performance.now());
  const themeFollow = createThemeFollow();
  const zenColumn = createZenColumn();
  let cwd = process.cwd();
  let hasSpoken = false;
  const reasoningView = createReasoningView({
    nativeHidden: () => SettingsManager2.create(cwd, getAgentDir()).getHideThinkingBlock()
  });
  const seedRuns = (manager) => {
    runs.reset();
    for (const entry of manager.buildContextEntries()) {
      for (const message of sessionEntryToContextMessages2(entry)) {
        if (message.role !== "assistant") {
          if (message.role !== "toolResult")
            runs.close();
          continue;
        }
        for (const block of message.content) {
          if (block.type === "text" && block.text.trim() !== "")
            runs.close();
          if (block.type === "toolCall") {
            if (hasZenToolView(block.name))
              runs.join(block.id, block.name);
            else
              runs.close();
          }
        }
      }
    }
    runs.close();
  };
  const lifecycle = createZenLifecycle({
    zenSwitch,
    history,
    startup: inMemoryStartupQuieting,
    parts: [silentHeader, zenEditorPart(history), turnStatus, workStatus, themeFollow, reasoningView, zenColumn],
    onBeforeEnter: (host) => {
      seedRuns(host.sessionManager);
      pi.events.emit("zen:change", { active: true });
    },
    onAfterLeave: () => {
      pi.events.emit("zen:change", { active: false });
    }
  });
  const showsZen = () => zenSwitch.look() !== "pi";
  registerToolViews(pi, runs, showsZen, Date.now);
  pi.on("session_start", (event, ctx) => {
    cwd = ctx.cwd;
    sessionManager = ctx.sessionManager;
    seedRuns(ctx.sessionManager);
    return lifecycle.sessionStarted(event.reason, ctx);
  });
  pi.on("session_tree", (_event, ctx) => seedRuns(ctx.sessionManager));
  pi.on("session_compact", (_event, ctx) => seedRuns(ctx.sessionManager));
  pi.on("session_shutdown", () => {
    workStatus.end();
    lifecycle.sessionEnded();
  });
  pi.on("agent_start", () => {
    runs.close();
    turnStatus.begin();
    workStatus.begin();
  });
  pi.on("turn_start", () => {
    turnStatus.open();
    workStatus.model("waiting");
    themeFollow.sync();
  });
  pi.on("message_start", (event) => {
    if (event.message.role === "user")
      runs.close();
    if (event.message.role === "assistant") {
      hasSpoken = false;
    }
  });
  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant")
      return;
    if (!hasSpoken && event.message.content.some((block) => block.type === "text" && block.text.trim() !== "")) {
      hasSpoken = true;
      runs.close();
    }
    const activity = activityFromUpdate(event.assistantMessageEvent);
    if (activity !== undefined)
      workStatus.model(activity);
    const phase = phaseFromContent(event.message.content);
    if (phase === undefined)
      return;
    turnStatus.produce(phase, event.message.usage);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant")
      return;
    turnStatus.commit(event.message.usage);
    workStatus.model("waiting");
  });
  pi.on("tool_execution_start", (event) => {
    workStatus.toolStarted(event.toolCallId, workLabel(event.toolName, toolInput(event.args), cwd), event.parentToolCallId);
  });
  pi.on("tool_execution_end", (event) => {
    workStatus.toolEnded(event.toolCallId);
  });
  pi.on("agent_end", () => {
    turnStatus.end();
    workStatus.end();
  });
  pi.registerMarkdownTransformer((markdown, context) => {
    if (!showsZen())
      return markdown;
    themeFollow.syncAfterRender();
    return orientMessage(markdown, context, liveSentInk());
  });
  pi.registerCommand("zen", {
    description: "Quiet the TUI with a centered column: on, off, details, or default [on|off]",
    getArgumentCompletions: zenCompletions,
    handler: lifecycle.command
  });
}
export {
  MAX_SIDE_MARGIN_RATIO,
  MIN_TEXT_WIDTH,
  computeZenColumn,
  zen as default,
  isZenActive,
  padZenLine,
  readZenDefault,
  writeZenDefault
};
