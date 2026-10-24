import { describe, expect, mock, test } from "bun:test";
import * as fs from "node:fs";
import { Marked, Tokenizer } from "/usr/local/bin/pi_cli/export-html/vendor/marked.min.js";

// Load the real @earendil-works/pi-tui implementation from pi.real so tests exercise
// the exact Markdown, Text, TruncatedText, wrapTextWithAnsi, and getOsc8LinkAtColumn code.
function loadRealPiTui() {
	const bin = fs.readFileSync("/usr/local/bin/pi_cli/pi.real", "utf8");
	const uStart = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/utils.ts");
	const uEnd = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/autocomplete.ts");
	const tStart = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/text.ts");
	const tEnd = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/loader.ts");
	const trStart = bin.indexOf(
		"// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/truncated-text.ts",
	);
	const trEnd = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/v-stack.ts");
	const mStart = bin.indexOf(
		"// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/markdown.ts",
	);
	const mEnd = bin.indexOf(
		"// ../../../../../../../../../../re_tmp/pi-mono/packages/tui/src/components/mouse-region.ts",
	);
	const cjkStart = bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/node_modules/marked-cjk-friendly");
	const cjkEnd = cjkStart >= 0 ? bin.indexOf("// ../../../../../../../../../../re_tmp/pi-mono/", cjkStart + 10) : -1;

	let capabilities = { images: null, trueColor: true, hyperlinks: false };
	const factoryCode = `
const __esm = (fn) => fn;
const init_get_east_asian_width = () => {};
const eastAsianWidth = () => 1;
const init_marked_esm = () => {};
const init_latex = () => {};
const init_terminal_image = () => {};
const renderLatex = () => undefined;
const isImageLine = () => false;
const getCapabilities = () => getCaps();
const setCapabilityOverrides = (overrides) => setCaps(overrides);
const hyperlink = (text, url) => \`\\x1B]8;;\${url}\\x1B\\\\\${text}\\x1B]8;;\\x1B\\\\\`;
const y = Tokenizer;
const Z = Marked;
${bin.slice(uStart, uEnd)}
${bin.slice(tStart, tEnd)}
${bin.slice(trStart, trEnd)}
${cjkStart >= 0 && cjkEnd > cjkStart ? bin.slice(cjkStart, cjkEnd) : "const init_dist = () => {}; const markedCjkFriendly = () => ({});"}
${bin.slice(mStart, mEnd)}
init_utils5();
init_text();
init_truncated_text();
init_markdown();
return {
  CURSOR_MARKER: "",
  Editor: class {},
  Key: {},
  matchesKey: (data, key) => data === key,
  Markdown,
  Text,
  TruncatedText,
  Marked: Z,
  visibleWidth,
  getOsc8LinkAtColumn,
  stripTerminalSequences,
  wrapTextWithAnsi,
  truncateToWidth,
  hyperlink,
  getCapabilities,
  setCapabilityOverrides,
};
`;

	return new Function("Tokenizer", "Marked", "getCaps", "setCaps", factoryCode)(
		Tokenizer,
		Marked,
		() => capabilities,
		(overrides: { hyperlinks?: boolean }) => {
			capabilities = { ...capabilities, ...overrides };
		},
	);
}

const realTui = loadRealPiTui();
mock.module("@earendil-works/pi-tui", () => realTui);

const {
	installOsc8LinkRendering,
	normalizeMarkdownForOsc8,
	splitTrailingUrlPunctuation,
} = await import("../extensions/osc8-links.ts");

installOsc8LinkRendering(realTui);

const markdownTheme = {
	heading: (t: string) => `\x1b[1m${t}\x1b[22m`,
	link: (t: string) => `\x1b[38;2;100;150;255m${t}\x1b[39m`,
	linkUrl: (t: string) => `\x1b[90m${t}\x1b[39m`,
	code: (t: string) => `\x1b[38;2;255;200;100m${t}\x1b[39m`,
	codeBlock: (t: string) => `\x1b[32m${t}\x1b[39m`,
	codeBlockBorder: (t: string) => `\x1b[90m${t}\x1b[39m`,
	quote: (t: string) => t,
	quoteBorder: (t: string) => t,
	hr: (t: string) => t,
	listBullet: (t: string) => t,
	bold: (t: string) => `\x1b[1m${t}\x1b[22m`,
	italic: (t: string) => `\x1b[3m${t}\x1b[23m`,
	underline: (t: string) => `\x1b[4m${t}\x1b[24m`,
	strikethrough: (t: string) => `\x1b[9m${t}\x1b[29m`,
};

/**
 * Collects every visible non-whitespace character across rendered lines that has
 * `getOsc8LinkAtColumn(line, col) === expectedUrl`, in reading order.
 */
function linkedTextForUrl(lines: string[], expectedUrl: string, includeSpaces = false): string {
	let collected = "";
	for (const line of lines) {
		const plain = realTui.stripTerminalSequences(line);
		let col = 0;
		for (const ch of plain) {
			const urlAtCol = realTui.getOsc8LinkAtColumn(line, col);
			if (urlAtCol === expectedUrl && (includeSpaces || ch !== " ")) {
				collected += ch;
			}
			col += 1;
		}
	}
	return collected;
}

describe("osc8-links extension", () => {
	test("forces hyperlinks capability to true even when initially false", () => {
		expect(realTui.getCapabilities().hyperlinks).toBe(true);
	});

	test("renders every character of a wrapped bare URL in a table with a clickable OSC 8 link", () => {
		const url =
			"https://www.internalfb.com/code/fbsource/www/flib/business_messaging/pricing/BizAIEnterprisePricingSkipUtil.php?lines=20-35";
		const sample = [
			"| Item | URL | Notes |",
			"|---|---|---|",
			`| Bare | ${url} | Narrow table column wrapping test |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(48);

		// The URL must wrap across multiple lines in the table cell, and EVERY character of the URL
		// across all wrapped lines must resolve to `url` via getOsc8LinkAtColumn.
		expect(linkedTextForUrl(lines, url)).toBe(url);

		// Table borders (│) and padding spaces must never inherit the OSC 8 link.
		for (const line of lines) {
			const plain = realTui.stripTerminalSequences(line);
			for (let col = 0; col < plain.length; col++) {
				if (plain[col] === "│") {
					expect(realTui.getOsc8LinkAtColumn(line, col)).toBeUndefined();
				}
			}
		}
	});

	test("renders every character of backticked inline-code URLs in a table with a clickable OSC 8 link", () => {
		const url1 = "https://www.internalfb.com/intern/profile/?id=3450151805140766";
		const url2 = "http://fwdproxy:8080";
		const sample = [
			"| Layer | Value |",
			"|---|---|",
			`| Profile | \`${url1}\` |`,
			`| Shell env | Your Fish variables export \`HTTPS_PROXY=${url2}\` globally |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(42);

		expect(linkedTextForUrl(lines, url1)).toBe(url1);
		expect(linkedTextForUrl(lines, url2)).toBe(url2);
	});

	test("renders every character of multi-word and formatted markdown links in tables with OSC 8", () => {
		const url1 = "https://docs.google.com/document/d/169tnVECEfiM6lhOyIeX2KsZybJT_qoocz1Efjw7QimE/edit";
		const url2 = "https://www.internalfb.com/code/fbsource/fbcode/3pai_tooling/launcher/main.rs?lines=6831-6835";
		const url3 = "https://www.internalfb.com/diff/D124815703";
		const sample = [
			"| Kind | Link |",
			"|---|---|",
			`| Multi-word | [Enterprise Solutions SEV Review Guidelines](${url1}) |`,
			`| Code inside link | [\`main.rs:6831-6835\`](${url2}) |`,
			`| Bold link | **[D124815703](${url3})** |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(34);

		expect(linkedTextForUrl(lines, url1)).toBe("EnterpriseSolutionsSEVReviewGuidelines");
		expect(linkedTextForUrl(lines, url2)).toBe("main.rs:6831-6835");
		expect(linkedTextForUrl(lines, url3)).toBe("D124815703");
	});

	test("normalizes raw OSC 8 sequences in markdown tables instead of mangling them", () => {
		const url1 = "https://www.internalfb.com/diff/D124815703";
		const url2 = "https://www.internalfb.com/diff/D124714457";
		const sample = [
			"| Date | Diff |",
			"|---|---|",
			`| Oct 12 | \x1b]8;;${url1}\x1b\\D124815703\x1b]8;;\x1b\\ |`,
			`| Oct 13 | \x1b]8;;${url2}\x07D124714457\x1b]8;;\x07 |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(45);

		expect(linkedTextForUrl(lines, url1)).toBe("D124815703");
		expect(linkedTextForUrl(lines, url2)).toBe("D124714457");
		const plainAll = lines.map((l: string) => realTui.stripTerminalSequences(l)).join("\n");
		expect(plainAll).not.toContain("D124815703\\https://");
	});

	test("preserves links and URLs after $variables in table cells without LaTeX swallowing", () => {
		const url1 = "https://www.internalfb.com/code/fbsource/fbcode/a.py?lines=1-5";
		const url2 = "https://www.internalfb.com/code/fbsource/fbcode/b.py?lines=10-20";
		const sample = [
			"| Step | Details |",
			"|---|---|",
			`| Fix | Set $NO_PROXY for [a.py:1-5](${url1}) and $HTTP_PROXY for ${url2} |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(44);

		expect(linkedTextForUrl(lines, url1)).toBe("a.py:1-5");
		expect(linkedTextForUrl(lines, url2)).toBe(url2);
	});

	test("links every character of URLs containing <redacted> or trailing underscores", () => {
		const graphqlUrl =
			"https://interngraph.intern.facebook.com/graphql?cat_app=1874465445999900&crypto_auth_tokens=<redacted>&doc=query+PiOwnership&variables=%7B%22id%22%3A%221%22%7D";
		const trailingUnderscoreUrl = "https://www.internalfb.com/code/fbsource/fbcode/foo_bar_";
		const sample = [
			"| Kind | URL |",
			"|---|---|",
			`| GraphQL | "${graphqlUrl}", source: err |`,
			`| Underscore | (${trailingUnderscoreUrl}) |`,
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(46);

		expect(linkedTextForUrl(lines, graphqlUrl)).toBe(graphqlUrl);
		expect(linkedTextForUrl(lines, trailingUnderscoreUrl)).toBe(trailingUnderscoreUrl);
	});

	test("links URLs inside fenced code blocks, Text, and TruncatedText", () => {
		const codeUrl = "https://www.internalfb.com/intern/chronos/jobs/?job=123456789";
		const md = new realTui.Markdown(`\`\`\`bash\ncurl "${codeUrl}"\n\`\`\``, 0, 0, markdownTheme);
		const mdLines = md.render(35);
		expect(linkedTextForUrl(mdLines, codeUrl)).toBe(codeUrl);

		const textUrl = "https://www.internalfb.com/diff/D987654321/very/long/path/that/wraps";
		const textComp = new realTui.Text(`See ${textUrl} for details`, 0, 0);
		const textLines = textComp.render(28);
		expect(linkedTextForUrl(textLines, textUrl)).toBe(textUrl);

		const truncComp = new realTui.TruncatedText(`Link: ${textUrl}`, 0, 0);
		const truncLines = truncComp.render(24);
		const expectedPrefix = "https://www.internalfb.com/diff/D987654321".slice(0, 24 - "Link: ".length - 3);
		expect(linkedTextForUrl(truncLines, textUrl)).toBe(expectedPrefix);
	});

	test("splitTrailingUrlPunctuation balances parentheses and strips sentence punctuation", () => {
		expect(splitTrailingUrlPunctuation("https://example.com/foo(bar)).")).toEqual({
			url: "https://example.com/foo(bar)",
			trailing: ").",
		});
		expect(splitTrailingUrlPunctuation("https://example.com/a_b_")).toEqual({
			url: "https://example.com/a_b_",
			trailing: "",
		});
		expect(
			normalizeMarkdownForOsc8("\x1b]8;;https://example.com\x1b\\Click\x1b]8;;\x1b\\"),
		).toBe("[Click](https://example.com)");
	});

	test("renders complex multi-column tables with mixed raw OSC 8, backticked URLs, and links", () => {
		const sample = [
			"| Date (UTC) | Diff / Thread | What Happened |",
			"|---|---|---|",
			"| Oct 12, 19:11 | \x1b]8;;https://www.internalfb.com/diff/D124815703\x1b\\D124815703\x1b]8;;\x1b\\ (`https://www.internalfb.com/diff/D124815703`) | Added checkpoint alongside (`https://www.internalfb.com/diff/D124805000`) and `HTTPS_PROXY=http://fwdproxy:8080`. |",
		].join("\n");

		const md = new realTui.Markdown(sample, 1, 0, markdownTheme);
		const lines = md.render(80);

		expect(linkedTextForUrl(lines, "https://www.internalfb.com/diff/D124815703")).toBe(
			"D124815703https://www.internalfb.com/diff/D124815703",
		);
		expect(linkedTextForUrl(lines, "https://www.internalfb.com/diff/D124805000")).toBe(
			"https://www.internalfb.com/diff/D124805000",
		);
		expect(linkedTextForUrl(lines, "http://fwdproxy:8080")).toBe("http://fwdproxy:8080");
	});

	test("renders <br>, <br/>, and <br /> in table cells as newlines and sizes columns by max line width", () => {
		const sample = [
			"| Traffic Path | Direction (Partner POV) | What to Allowlist | Notes |",
			"|---|---|---|---|",
			"| Enterprise Solutions Private Connectors (Membrane → Partner API) | Inbound (TCP 443) | 4 static IPs:<br>3.124.215.118<br>44.207.182.216<br/>47.130.246.90<br />54.232.69.185 | Used when the business agent executes an agent tool call through a Membrane connector. Membrane runs on external cloud infra (AWS) outside Meta's ASN. |",
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const plainLines = md.render(98).map((l: string) => realTui.stripTerminalSequences(l));
		const rendered = plainLines.join("\n");

		expect(rendered).not.toContain("<br");
		expect(rendered).toContain("│ 4 static IPs:");
		expect(rendered).toContain("│ 3.124.215.118");
		expect(rendered).toContain("│ 44.207.182.216");
		expect(rendered).toContain("│ 47.130.246.90");
		expect(rendered).toContain("│ 54.232.69.185");

		// Column 3 ("What to Allowlist", header 17 chars, max IP line 14 chars) should not be
		// inflated to the sum of all 5 lines (66 chars).
		const topBorder = plainLines[0]!;
		const colSegments = topBorder.slice(1, -1).split("┬");
		// Each segment has 2 border dashes around the column width (`─` + width + `─`).
		const allowlistColWidth = colSegments[2]!.length - 2;
		expect(allowlistColWidth).toBeLessThanOrEqual(17);
		expect(allowlistColWidth).toBeGreaterThanOrEqual(14);
	});

	test("preserves <br> inside literal inline code while converting <br> after $variables and around links", () => {
		const url1 = "https://example.com/one";
		const url2 = "https://example.com/two";
		const sample = [
			"| Case | Output |",
			"|---|---|",
			`| Env & Links | $FOO_BAR <br> ${url1}<br>${url2} |`,
			"| Literal code | Use `<br>` for breaks |",
		].join("\n");

		const md = new realTui.Markdown(sample, 0, 0, markdownTheme);
		const lines = md.render(60);
		const plain = lines.map((l: string) => realTui.stripTerminalSequences(l)).join("\n");

		expect(plain).toContain("$FOO_BAR");
		expect(plain).toContain("Use <br> for breaks");
		expect(linkedTextForUrl(lines, url1)).toBe(url1);
		expect(linkedTextForUrl(lines, url2)).toBe(url2);
	});

	test("wraps explicit URLs in paragraphs, lists, and Text without leaking OSC 8 or extra leading spaces", () => {
		const url = "https://www.internalfb.com/diff/D124714457";
		const md = new realTui.Markdown(
			`See ${url} and then some more text after it\n\n- \`${url}\` in a list item`,
			1,
			0,
			markdownTheme,
		);
		// At width=48 (contentWidth=46), "See " + url is exactly 46 columns, forcing a wrap right after the URL.
		const lines = md.render(48);
		expect(realTui.stripTerminalSequences(lines[0]!)).toBe(` See ${url} `);
		expect(realTui.stripTerminalSequences(lines[1]!).trimEnd()).toBe(" and then some more text after it");

		for (let col = 0; col < realTui.stripTerminalSequences(lines[1]!).length; col++) {
			expect(realTui.getOsc8LinkAtColumn(lines[1]!, col)).toBeUndefined();
		}

		expect(linkedTextForUrl(lines, url)).toBe(url + url);

		const textComp = new realTui.Text(`See ${url} for details`, 1, 0);
		const textLines = textComp.render(48);
		expect(realTui.stripTerminalSequences(textLines[0]!)).toBe(` See ${url} `);
		expect(realTui.stripTerminalSequences(textLines[1]!).trimEnd()).toBe(" for details");
		expect(textLines[0]).toContain("\x1b[4m");
		expect(linkedTextForUrl(textLines, url)).toBe(url);
	});

	test("strips trailing closing brackets and braces from bare GFM autolinks", () => {
		const url1 = "https://www.internalfb.com/diff/D124714457";
		const url2 = "https://wa.me/5511992611510";
		const md = new realTui.Markdown(`Refs: [${url1}] and {${url2}}`, 0, 0, markdownTheme);
		const lines = md.render(80);

		expect(linkedTextForUrl(lines, url1)).toBe(url1);
		expect(linkedTextForUrl(lines, url2)).toBe(url2);
	});
});
