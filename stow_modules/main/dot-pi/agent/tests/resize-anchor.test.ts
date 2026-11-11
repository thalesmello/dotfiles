import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Redirect "@earendil-works/pi-tui" to resize-anchor-host.ts so this test
// runs in isolation without a process-wide mock.module that would affect
// other test files in the same Bun process.
const hostPath = join(import.meta.dir, "resize-anchor-host.ts");
const { FakeContainer, FakeScrollView } = await import(pathToFileURL(hostPath).href);

const extensionPath = join(import.meta.dir, "../extensions/resize-anchor.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
if (!extensionSource.includes('from "@earendil-works/pi-tui"')) {
	throw new Error("resize-anchor.ts no longer imports pi-tui as this test expects");
}
const redirectedSource = extensionSource.replace(
	'from "@earendil-works/pi-tui"',
	`from ${JSON.stringify(pathToFileURL(hostPath).href)}`,
);
const redirectedPath = join(tmpdir(), `resize-anchor-extension-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);
afterAll(() => {
	fs.rmSync(redirectedPath, { force: true });
});

const {
	default: resizeAnchor,
	analyzeBlockLines,
	buildLayoutBlocks,
	captureBlockLineAnchor,
	captureScrollAnchor,
	resolveBlockLineAnchor,
	resolveScrollAnchor,
} = await import(pathToFileURL(redirectedPath).href);

// ---------------------------------------------------------------------------
// Test helpers: greedy word-wrapping components that mimic pi-tui's renderers
// ---------------------------------------------------------------------------

function wrapWords(text: string, width: number): string[] {
	const safeWidth = Math.max(1, Math.floor(width));
	const paragraphs = text.split("\n");
	const out: string[] = [];
	for (const para of paragraphs) {
		if (para.trim() === "") {
			out.push("");
			continue;
		}
		const words = para.trim().split(/\s+/);
		let current = "";
		for (const word of words) {
			if (!current) {
				if (word.length <= safeWidth) {
					current = word;
				} else {
					for (let i = 0; i < word.length; i += safeWidth) {
						const slice = word.slice(i, i + safeWidth);
						if (slice.length === safeWidth && i + safeWidth < word.length) {
							out.push(slice);
						} else {
							current = slice;
						}
					}
				}
			} else if (current.length + 1 + word.length <= safeWidth) {
				current += ` ${word}`;
			} else {
				out.push(current);
				current = word;
			}
		}
		if (current) out.push(current);
	}
	return out.length > 0 ? out : [""];
}

class SpacerComponent {
	constructor(private readonly rows = 1) {}
	render(_width: number): string[] {
		return Array.from({ length: this.rows }, () => "");
	}
}

class ParagraphComponent {
	cachedLines: string[] | undefined;
	constructor(readonly text: string) {}
	render(width: number): string[] {
		const lines = wrapWords(this.text, Math.max(1, width - 2)).map((line) => ` ${line}`);
		this.cachedLines = lines;
		return lines;
	}
}

class FramedCodeComponent {
	constructor(
		readonly lang: string,
		readonly codeLines: readonly string[],
	) {}
	render(width: number): string[] {
		const inner = Math.max(1, width - 4);
		const fill = Math.max(1, width - this.lang.length - 14);
		const out: string[] = [`╭─ ${this.lang} ${"─".repeat(fill)} ⧉ copy ─╮`];
		for (const raw of this.codeLines) {
			if (raw.trim() === "") {
				out.push(`│ ${" ".repeat(inner)} │`);
				continue;
			}
			for (const piece of wrapWords(raw, inner)) {
				const pad = " ".repeat(Math.max(0, inner - piece.length));
				out.push(`│ ${piece}${pad} │`);
			}
		}
		out.push(`╰${"─".repeat(Math.max(1, width - 2))}╯`);
		return out;
	}
}

class TruncatedToolPreviewComponent {
	constructor(readonly lines: readonly string[]) {}
	render(width: number): string[] {
		const limit = Math.max(4, width - 2);
		return this.lines.map((line) => (line.length > limit ? `  ${line.slice(0, limit - 1)}…` : `  ${line}`));
	}
}

class FakeMarkdownComponent {
	readonly paddingY: number;
	cachedLines: string[] | undefined;
	cachedTokens: { deref: () => { tokens: Array<{ type: string; raw: string }> } } | undefined;
	blocks: { deref: () => Map<string, { lines: string[] }> } | undefined;

	constructor(
		private readonly tokenDefs: ReadonlyArray<{ type: string; raw: string; text: string }>,
		paddingY = 0,
	) {
		this.paddingY = paddingY;
	}

	render(width: number): string[] {
		const tokens = this.tokenDefs.map((t) => ({ type: t.type, raw: t.raw }));
		const blockMap = new Map<string, { lines: string[] }>();
		const content: string[] = [];
		for (let i = 0; i < this.tokenDefs.length; i++) {
			const def = this.tokenDefs[i]!;
			const wrapped = wrapWords(def.text, Math.max(1, width - 2)).map((line) =>
				def.type === "blockquote" ? ` │ ${line}` : ` ${line}`,
			);
			if (i < this.tokenDefs.length - 1) wrapped.push("");
			blockMap.set(def.raw, { lines: wrapped });
			content.push(...wrapped);
		}
		this.cachedTokens = { deref: () => ({ tokens }) };
		this.blocks = { deref: () => blockMap };
		const pad = Array.from({ length: this.paddingY }, () => "");
		const result = [...pad, ...content, ...pad];
		this.cachedLines = result;
		return result;
	}
}

/** Simulate pi-tui's `layoutComponent` pass for a `ScrollView`. */
function layoutScrollView(view: FakeScrollView, width: number, viewportHeight: number): string[] {
	const contentWidth = view.getContentWidth(width);
	const child = view.child as { render: (w: number) => string[] };
	const lines = child.render(contentWidth);
	view.updateLayout(lines.length, viewportHeight, () => {});
	return lines;
}

// ---------------------------------------------------------------------------
// Extension harness
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx: any) => Promise<any> | any;

const handlers = new Map<string, Handler[]>();
const commands = new Map<string, { handler: Handler }>();
const notifications: Array<{ message: string; type?: string }> = [];

const fakePi: any = {
	on(event: string, handler: Handler) {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
	},
	registerCommand(name: string, config: { handler: Handler }) {
		commands.set(name, config);
	},
};

resizeAnchor(fakePi);

const tuiCtx: any = {
	mode: "tui",
	ui: {
		notify(message: string, type?: string) {
			notifications.push({ message, type });
		},
	},
};

async function emit(event: string, eventData: any = {}, ctx: any = tuiCtx): Promise<any> {
	let result: any;
	for (const handler of handlers.get(event) ?? []) {
		result = await handler(eventData, ctx);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("analyzeBlockLines & captureBlockLineAnchor / resolveBlockLineAnchor", () => {
	test("maps a mid-paragraph line across narrowing and widening by exact character offset", () => {
		const paragraph =
			"In fullscreen mode the transcript follows new output only while it sits at the exact end. " +
			"Scroll up to read the last answer and follow mode turns off, so the indicator stays up " +
			"and a new message and its response grow below the fold while the view stays behind.";

		const lines80 = wrapWords(paragraph, 76);
		const lines40 = wrapWords(paragraph, 36);
		expect(lines80.length).toBeGreaterThan(2);
		expect(lines40.length).toBeGreaterThan(lines80.length);

		// Pick row 2 at width 80; find its first word and verify where that word lands at width 40.
		const targetRow80 = 2;
		const firstWord = lines80[targetRow80]!.trim().split(/\s+/)[0]!;
		const anchor = captureBlockLineAnchor(lines80, targetRow80);
		expect(anchor.kind).toBe("segment");

		const resolvedRow40 = resolveBlockLineAnchor(lines40, anchor);
		expect(lines40[resolvedRow40]).toContain(firstWord);

		// Resolving the same anchor back against width 80 returns the exact original row.
		const resolvedBack80 = resolveBlockLineAnchor(lines80, anchor);
		expect(resolvedBack80).toBe(targetRow80);
	});

	test("strips blockquote bars, framed code borders, and copy buttons when computing content offsets", () => {
		const framed = new FramedCodeComponent("typescript", [
			"const alpha = computeFirstValueFromInput(request, context, options);",
			"",
			"const beta = transformSecondValueWithLongIdentifier(alpha, configuration);",
		]);
		const lines80 = framed.render(80);
		const lines36 = framed.render(36);

		const analyzed80 = analyzeBlockLines(lines80);
		const analyzed36 = analyzeBlockLines(lines36);
		// Blank code line inside the frame splits the code body into 2 width-invariant segments.
		expect(analyzed80.segments.length).toBe(2);
		expect(analyzed36.segments.length).toBe(2);
		expect(analyzed80.segments[0]!.totalChars).toBe(analyzed36.segments[0]!.totalChars);
		expect(analyzed80.segments[1]!.totalChars).toBe(analyzed36.segments[1]!.totalChars);

		// Anchoring on the start of `const beta` at width 80 lands on `const beta` at width 36.
		const betaRow80 = lines80.findIndex((line) => line.includes("const beta"));
		const anchor = captureBlockLineAnchor(lines80, betaRow80);
		const betaRow36 = resolveBlockLineAnchor(lines36, anchor);
		expect(lines36[betaRow36]).toContain("const beta");
	});

	test("preserves logical row position in Markdown tables when cells wrap", () => {
		const table80 = [
			"┌──────────┬──────────────────────────────────────────────────────┐",
			"│ Feature  │ Description                                          │",
			"├──────────┼──────────────────────────────────────────────────────┤",
			"│ Alpha    │ First row with a long description that wraps narrow  │",
			"├──────────┼──────────────────────────────────────────────────────┤",
			"│ Beta     │ Second row that the user anchored at the top         │",
			"└──────────┴──────────────────────────────────────────────────────┘",
		];
		const table44 = [
			"┌──────────┬───────────────────────────┐",
			"│ Feature  │ Description               │",
			"├──────────┼───────────────────────────┤",
			"│ Alpha    │ First row with a long     │",
			"│          │ description that wraps    │",
			"│          │ narrow                    │",
			"├──────────┼───────────────────────────┤",
			"│ Beta     │ Second row that the user  │",
			"│          │ anchored at the top       │",
			"└──────────┴───────────────────────────┘",
		];

		// Row 5 at width 80 is `│ Beta ... │`. At width 44, `│ Beta ... │` is at row 7.
		const anchor = captureBlockLineAnchor(table80, 5);
		expect(resolveBlockLineAnchor(table44, anchor)).toBe(7);

		// Row 4 at width 80 is the `├───┼───┤` separator right above Beta; at width 44 it is row 6.
		const sepAnchor = captureBlockLineAnchor(table80, 4);
		expect(resolveBlockLineAnchor(table44, sepAnchor)).toBe(6);
	});

	test("keeps exact line index for right-truncated tool preview lines", () => {
		const tool = new TruncatedToolPreviewComponent([
			"1: import { Container, ScrollView } from '@earendil-works/pi-tui';",
			"2: export function firstHelperWithAVeryLongSignature(alpha: string, beta: number) {",
			"3:   return alpha.repeat(beta).slice(0, 120);",
			"4: }",
			"5: export function targetFunctionAtTopOfViewport(config: Record<string, unknown>) {",
			"6:   return Object.keys(config).length;",
			"7: }",
		]);
		const lines90 = tool.render(90);
		const lines35 = tool.render(35);

		const anchor = captureBlockLineAnchor(lines90, 4);
		expect(resolveBlockLineAnchor(lines35, anchor)).toBe(4);
		expect(lines35[4]).toContain("5: export function");
	});
});

// ---------------------------------------------------------------------------
// Full ScrollView + Container integration tests
// ---------------------------------------------------------------------------

describe("resize-anchor extension", () => {
	test("installs patches on session_start and restores them on session_shutdown", async () => {
		const scrollProto: any = FakeScrollView.prototype;
		const containerProto: any = FakeContainer.prototype;
		const origUpdateLayout = scrollProto.updateLayout;
		const origGetContentWidth = scrollProto.getContentWidth;
		const origContainerRender = containerProto.render;

		await emit("session_start");
		expect(scrollProto.updateLayout).not.toBe(origUpdateLayout);
		expect(scrollProto.getContentWidth).not.toBe(origGetContentWidth);
		expect(containerProto.render).not.toBe(origContainerRender);

		await emit("session_shutdown");
		expect(scrollProto.updateLayout).toBe(origUpdateLayout);
		expect(scrollProto.getContentWidth).toBe(origGetContentWidth);
		expect(containerProto.render).toBe(origContainerRender);
	});

	test("does not install outside tui mode", async () => {
		const scrollProto: any = FakeScrollView.prototype;
		const origUpdateLayout = scrollProto.updateLayout;

		await emit("session_start", {}, { ...tuiCtx, mode: "rpc" });
		expect(scrollProto.updateLayout).toBe(origUpdateLayout);
	});

	test("anchors the chat to the top visible line when resizing narrower and wider", async () => {
		await emit("session_start");

		const documentContainer = new FakeContainer();
		const headerContainer = new FakeContainer();
		const chatContainer = new FakeContainer();
		documentContainer.addChild(headerContainer);
		documentContainer.addChild(chatContainer);

		headerContainer.addChild(new ParagraphComponent("Pi v1.5.0 header banner that wraps when the terminal narrows"));
		headerContainer.addChild(new SpacerComponent(1));

		const turn1User = new ParagraphComponent(
			"Can you explain how the layout engine measures and positions scroll views in fullscreen mode?",
		);
		const turn1Assistant = new FakeMarkdownComponent([
			{
				type: "paragraph",
				raw: "p1",
				text: "First paragraph: the layout engine measures the document container at the current content width and records each child component height in mouseLayout so mouse events can be routed.",
			},
			{
				type: "paragraph",
				raw: "p2",
				text: "Second paragraph: when you scroll up into history, followEnd turns off and the viewport slices lines starting at scrollTop. Resizing the terminal width re-wraps every paragraph above.",
			},
			{
				type: "blockquote",
				raw: "q1",
				text: "Key invariant: the line of text sitting at the top of the terminal before the width change should remain at the top of the terminal after the width change.",
			},
		]);
		const turn2User = new ParagraphComponent(
			"Now update the configuration so terminal width resizes keep that top line anchored.",
		);
		const turn2Assistant = new ParagraphComponent(
			"Done! The resize-anchor extension hooks Container.render and ScrollView.updateLayout to track the exact character offset of the top visible line across width changes.",
		);

		chatContainer.addChild(turn1User);
		chatContainer.addChild(new SpacerComponent(1));
		chatContainer.addChild(turn1Assistant);
		chatContainer.addChild(new SpacerComponent(1));
		chatContainer.addChild(turn2User);
		chatContainer.addChild(new SpacerComponent(1));
		chatContainer.addChild(turn2Assistant);

		const view = new FakeScrollView(documentContainer, { follow: "end", primary: true });
		const lines100 = layoutScrollView(view, 100, 8);
		expect(view.isFollowingEnd).toBe(true);

		// Scroll up so the top of the terminal is on the second line of turn1Assistant's second paragraph ("p2").
		const p2SecondLineRow100 = lines100.findIndex((line) => line.includes("Second paragraph:")) + 1;
		const topLineAt100 = lines100[p2SecondLineRow100]!;
		const anchorFirstWord = topLineAt100.trim().split(/\s+/)[0]!;

		view.scrollTo(p2SecondLineRow100, { disableFollow: true });
		layoutScrollView(view, 100, 8);
		expect(view.scrollTop).toBe(p2SecondLineRow100);
		expect(view.isFollowingEnd).toBe(false);

		// Resize narrower: 100 -> 50 columns.
		const lines50 = layoutScrollView(view, 50, 8);
		expect(view.isFollowingEnd).toBe(false);
		expect(view.scrollTop).not.toBe(p2SecondLineRow100);
		expect(lines50[view.scrollTop]).toContain(anchorFirstWord);

		// Resize even narrower: 50 -> 36 columns, then wider: 36 -> 72 -> 100 columns (continuous drag).
		const lines36 = layoutScrollView(view, 36, 8);
		expect(lines36[view.scrollTop]).toContain(anchorFirstWord);

		const lines72 = layoutScrollView(view, 72, 8);
		expect(lines72[view.scrollTop]).toContain(anchorFirstWord);

		// Returning to width 100 restores the exact starting row with zero cumulative drift.
		layoutScrollView(view, 100, 8);
		expect(view.scrollTop).toBe(p2SecondLineRow100);

		await emit("session_shutdown");
	});

	test("keeps following the end on width resize when isFollowingEnd is true", async () => {
		await emit("session_start");

		const doc = new FakeContainer();
		doc.addChild(
			new ParagraphComponent(
				"Long message one that wraps across several rows when the terminal gets narrower or wider in fullscreen mode.",
			),
		);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(
			new ParagraphComponent(
				"Long message two at the bottom of the transcript that should stay pinned to the bottom while following.",
			),
		);

		const view = new FakeScrollView(doc, { follow: "end", primary: true });
		const lines100 = layoutScrollView(view, 100, 4);
		expect(view.isFollowingEnd).toBe(true);
		expect(view.scrollTop).toBe(lines100.length - 4);

		const lines40 = layoutScrollView(view, 40, 4);
		expect(view.isFollowingEnd).toBe(true);
		expect(view.scrollTop).toBe(lines40.length - 4);

		await emit("session_shutdown");
	});

	test("widening that clamps scrollTop to maxScrollTop does not re-enable followEnd, so narrowing back restores position", async () => {
		await emit("session_start");

		const doc = new FakeContainer();
		for (let i = 1; i <= 5; i++) {
			doc.addChild(
				new ParagraphComponent(
					`Message ${i}: a moderately long line of conversation text that takes multiple rows at narrow widths but fits on one row when wide.`,
				),
			);
			if (i < 5) doc.addChild(new SpacerComponent(1));
		}

		const view = new FakeScrollView(doc, { follow: "end", primary: true });
		const lines40 = layoutScrollView(view, 40, 8);
		const msg4Row40 = lines40.findIndex((line) => line.includes("Message 4:"));
		expect(msg4Row40).toBeGreaterThan(0);

		// Scroll to Message 4 at width 40 (not at the end).
		view.scrollTo(msg4Row40, { disableFollow: true });
		layoutScrollView(view, 40, 8);
		expect(view.isFollowingEnd).toBe(false);
		expect(view.scrollTop).toBe(msg4Row40);

		// Widen to 160 columns: total height is now 9 lines, viewport is 8, so maxScrollTop is 1 (< msg4Row160 = 6).
		layoutScrollView(view, 160, 8);
		expect(view.scrollTop).toBe(1);
		expect(view.isFollowingEnd).toBe(false);

		// Narrow back to 40 columns: restores exact Message 4 row instead of sticking to the bottom.
		layoutScrollView(view, 40, 8);
		expect(view.scrollTop).toBe(msg4Row40);
		expect(view.isFollowingEnd).toBe(false);

		await emit("session_shutdown");
	});

	test("manual scrolling between width resizes captures a fresh anchor at the new scroll position", async () => {
		await emit("session_start");

		const doc = new FakeContainer();
		const msg1 = new ParagraphComponent(
			"Alpha section: this introductory paragraph wraps across multiple lines when the terminal width changes.",
		);
		const msg2 = new ParagraphComponent(
			"Beta section: this middle paragraph is the first place we anchor before scrolling down to Gamma.",
		);
		const msg3 = new ParagraphComponent(
			"Gamma section: this third paragraph is where the user manually scrolls before the second width resize.",
		);
		const msg4 = new ParagraphComponent(
			"Delta section: trailing content below Gamma so the viewport never hits the bottom of the transcript.",
		);
		doc.addChild(msg1);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(msg2);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(msg3);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(msg4);

		const view = new FakeScrollView(doc, { follow: "end", primary: true });
		const lines90 = layoutScrollView(view, 90, 4);

		// Anchor at Beta at width 90, then resize to 45.
		const betaRow90 = lines90.findIndex((line) => line.includes("Beta section:"));
		view.scrollTo(betaRow90, { disableFollow: true });
		layoutScrollView(view, 90, 4);

		const lines45 = layoutScrollView(view, 45, 4);
		expect(lines45[view.scrollTop]).toContain("Beta section:");

		// Now manually scroll to Gamma at width 45, then resize to 90.
		const gammaRow45 = lines45.findIndex((line) => line.includes("Gamma section:"));
		view.scrollTo(gammaRow45, { disableFollow: true });
		layoutScrollView(view, 45, 4);

		const lines90Again = layoutScrollView(view, 90, 4);
		expect(lines90Again[view.scrollTop]).toContain("Gamma section:");

		await emit("session_shutdown");
	});

	test("reports active and inactive states via /resize-anchor command", async () => {
		notifications.length = 0;
		await emit("session_start");
		await commands.get("resize-anchor")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("resize-anchor: active");

		await emit("session_shutdown");
		await commands.get("resize-anchor")!.handler("", tuiCtx);
		expect(notifications.at(-1)?.message).toContain("resize-anchor: inactive");
	});

	test("anchors non-Container custom ScrollView children (e.g. subagent fullscreen viewer)", async () => {
		await emit("session_start");

		const customChild = {
			render(width: number): string[] {
				return [
					...wrapWords(
						"Subagent turn 1: scouting the repository layout and collecting file references across packages.",
						Math.max(1, width - 2),
					),
					"",
					...wrapWords(
						"Subagent turn 2: verifying the anchored line of text stays at the top of the fullscreen subagent viewer.",
						Math.max(1, width - 2),
					),
					"",
					...wrapWords(
						"Subagent turn 3: trailing output below the fold so the viewer has plenty of scroll range.",
						Math.max(1, width - 2),
					),
				];
			},
		};

		const view = new FakeScrollView(customChild, { follow: "end", primary: false });
		const lines80 = layoutScrollView(view, 80, 4);
		const turn2Row80 = lines80.findIndex((line) => line.includes("Subagent turn 2:"));

		view.scrollTo(turn2Row80, { disableFollow: true });
		layoutScrollView(view, 80, 4);
		expect(view.scrollTop).toBe(turn2Row80);

		const lines36 = layoutScrollView(view, 36, 4);
		expect(lines36[view.scrollTop]).toContain("Subagent turn 2:");

		layoutScrollView(view, 80, 4);
		expect(view.scrollTop).toBe(turn2Row80);

		await emit("session_shutdown");
	});

	test("keeps the anchor on a message in history even while a later message streams at the bottom", async () => {
		await emit("session_start");

		const doc = new FakeContainer();
		const msg1 = new ParagraphComponent(
			"Historical message one: this earlier explanation wraps into more lines when the terminal width shrinks.",
		);
		const msg2 = new ParagraphComponent(
			"Historical message two: the user has scrolled here to read this specific explanation at the top of the terminal.",
		);
		const streamingMsg = new ParagraphComponent("Streaming response start.");
		doc.addChild(msg1);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(msg2);
		doc.addChild(new SpacerComponent(1));
		doc.addChild(streamingMsg);

		const view = new FakeScrollView(doc, { follow: "end", primary: true });
		const lines100 = layoutScrollView(view, 100, 4);
		const msg2Row100 = lines100.findIndex((line) => line.includes("Historical message two:"));

		view.scrollTo(msg2Row100, { disableFollow: true });
		layoutScrollView(view, 100, 4);

		// Narrow to 45 columns -> anchors to Historical message two.
		const lines45 = layoutScrollView(view, 45, 4);
		expect(lines45[view.scrollTop]).toContain("Historical message two:");

		// Now streamingMsg at the bottom grows while the user stays at width 45 without scrolling.
		streamingMsg.text =
			"Streaming response start. More tokens arrive at the bottom of the transcript across several wrapped rows.";
		layoutScrollView(view, 45, 4);
		expect(lines45[view.scrollTop]).toContain("Historical message two:");

		// Widen back to 100 columns -> still returns to the exact row of Historical message two.
		layoutScrollView(view, 100, 4);
		expect(view.scrollTop).toBe(msg2Row100);

		await emit("session_shutdown");
	});
});
