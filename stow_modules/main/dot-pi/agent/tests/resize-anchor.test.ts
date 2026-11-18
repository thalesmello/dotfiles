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

	describe("zen look toggles (render-time globalThis.piZenSwitch detection)", () => {
		const look = () => (globalThis as any).piZenSwitch?.look ?? "pi";
		const setLook = (value: "pi" | "zen") => {
			(globalThis as any).piZenSwitch = { look: value };
		};

		class ZenHidden {
			constructor(readonly inner: ParagraphComponent) {}
			render(width: number): string[] {
				return look() === "zen" ? [] : this.inner.render(width);
			}
		}

		/** Same constructor name as pi's real chat container (isPlainGroupingContainer requires it). */
		class Container extends FakeContainer {}

		/** Leaf exposing its source `.text` like pi's Markdown/Text components. */
		class TextLeaf {
			constructor(public text: string) {}
			render(width: number): string[] {
				return wrapWords(this.text, Math.max(1, width - 2)).map((l) => ` ${l}`);
			}
		}

		/** Thinking block: visible only in the pi look. */
		class ThinkingLeaf extends TextLeaf {
			render(width: number): string[] {
				return look() === "zen" ? [] : super.render(width);
			}
		}

		const LONG = (name: string) =>
			`${name} marker: this paragraph is long enough that it wraps over several rows at both wide and narrow zen column widths.`;

		function buildDoc(opts: { tool?: boolean; narrow?: boolean; thinking?: boolean } = {}) {
			const narrow = opts.narrow ?? true;
			const doc = new FakeContainer();
			// Own render wrapper on the DOCUMENT, like pi-zen's column wrapper.
			const originalRender = doc.render;
			doc.render = function (this: FakeContainer, width: number): string[] {
				return originalRender.call(this, narrow && look() === "zen" ? Math.max(1, width - 20) : width);
			};
			const header = new ZenHidden(new ParagraphComponent("Pi header banner with version and keybinding hints that wrap"));
			const resources = new ZenHidden(new ParagraphComponent("Resources: skills, prompts, extensions, themes listed here"));
			const chat = new Container();
			doc.addChild(header);
			doc.addChild(resources);
			doc.addChild(chat);
			const owners: Record<string, any> = {};
			const names = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
			for (const name of names) {
				if (opts.tool && name === "Gamma") {
					const tool = {
						lines: [`  tool-output-one ${name}`, `  tool-output-two ${name}`, `  tool-output-three ${name}`],
						render(_w: number) {
							return look() === "zen" ? [] : this.lines;
						},
					};
					owners[name] = tool;
					chat.addChild(tool);
				} else {
					const owner = new FakeContainer();
					if (opts.thinking && name === "Delta") {
						owner.addChild(new ThinkingLeaf("Thinking: pondering a long chain of reasoning steps before answering at all."));
					}
					owner.addChild(new TextLeaf(LONG(name)));
					owners[name] = owner;
					chat.addChild(owner);
				}
				chat.addChild(new SpacerComponent(1));
			}
			return { doc, chat, owners };
		}

		const H = 6;
		const rowOf = (lines: string[], needle: string) => lines.findIndex((l) => l.includes(needle));
		const topText = (view: any, lines: string[]) => lines[view.scrollTop]!;

		async function withZen(fn: () => Promise<void> | void) {
			try {
				await emit("session_start");
				await fn();
			} finally {
				delete (globalThis as any).piZenSwitch;
				await emit("session_shutdown");
			}
		}

		test("mid-chat top line survives pi -> zen -> pi with header/resources hidden and a narrower column", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				const row = rowOf(l0, "Gamma marker");
				view.scrollTo(row + 1, { disableFollow: true });
				layoutScrollView(view, 80, H);
				const original = topText(view, l0).trim();
				const originalTop = view.scrollTop;
				const word = original.split(/\s+/)[0]!;

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(view.isFollowingEnd).toBe(false);
				expect(lz[view.scrollTop]).toContain(word);

				setLook("pi");
				layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(originalTop);
			}));

		test("zero scrollTop in the startup header anchors to the first chat block in both looks", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				layoutScrollView(view, 80, H);
				view.scrollTo(0, { disableFollow: true });
				const l0 = layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(0);
				expect(l0[0]).toContain("Pi header");

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(lz[view.scrollTop]).toContain("Alpha marker");
				expect(rowOf(lz, "Alpha marker")).toBe(view.scrollTop);
				expect(view.isFollowingEnd).toBe(false);

				setLook("pi");
				const lb = layoutScrollView(view, 80, H);
				// Restoring pi keeps the first CHAT row visible instead of returning into the header.
				expect(view.scrollTop).toBe(rowOf(lb, "Alpha marker"));
				expect(lb[view.scrollTop]).toContain("Alpha marker");
			}));

		test("zero scrollTop starting in zen keeps the first chat row when switching to pi and back", () =>
			withZen(() => {
				setLook("zen");
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				layoutScrollView(view, 80, H);
				view.scrollTo(0, { disableFollow: true });
				const lz = layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(0);
				expect(lz[0]).toContain("Alpha marker");

				setLook("pi");
				const lp = layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(rowOf(lp, "Alpha marker"));
				expect(lp[view.scrollTop]).toContain("Alpha marker");

				setLook("zen");
				const lz2 = layoutScrollView(view, 80, H);
				expect(lz2[view.scrollTop]).toContain("Alpha marker");
			}));

		test("fixed content width: only header/resources hide, no narrowing, top chat line is preserved", () =>
			withZen(() => {
				const { doc } = buildDoc({ narrow: false });
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				const row = rowOf(l0, "Beta marker");
				view.scrollTo(row, { disableFollow: true });
				layoutScrollView(view, 80, H);
				const originalTop = view.scrollTop;

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(lz.length).toBeLessThan(l0.length);
				expect(lz[view.scrollTop]).toContain("Beta marker");
				expect(view.scrollTop).toBeLessThan(originalTop);

				setLook("pi");
				layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(originalTop);
			}));

		test("following the bottom captures the top visible line, disables follow, and resolves before painting", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				expect(view.isFollowingEnd).toBe(true);
				const word = l0[view.scrollTop]!.trim().split(/\s+/)[0]!;

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				// Same call that observed the mode change already paints the anchored row.
				expect(view.isFollowingEnd).toBe(false);
				expect(lz[view.scrollTop]).toContain(word);
			}));

		test("replaced text leaf after invalidation matches by recorded text even with preceding thinking removed", () =>
			withZen(() => {
				const { doc, owners } = buildDoc({ thinking: true });
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				const row = rowOf(l0, "Delta marker");
				view.scrollTo(row, { disableFollow: true });
				layoutScrollView(view, 80, H);
				const originalTop = view.scrollTop;

				// invalidate() recreates the text leaf under the same owner (same source text).
				const idx = owners.Delta.children.length - 1;
				owners.Delta.children[idx] = new TextLeaf(LONG("Delta"));

				// In zen the thinking block above disappears, so owner-proportional offsets would miss.
				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(lz[view.scrollTop]).toContain("Delta marker");
				expect(view.scrollTop).toBe(rowOf(lz, "Delta marker"));

				setLook("pi");
				const lb = layoutScrollView(view, 80, H);
				expect(lb[view.scrollTop]).toContain("Delta marker");
				expect(view.scrollTop).toBe(originalTop);
			}));

		test("manual scroll after a toggle replaces the preserved original anchor", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				view.scrollTo(rowOf(l0, "Beta marker"), { disableFollow: true });
				layoutScrollView(view, 80, H);

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(lz[view.scrollTop]).toContain("Beta marker");

				// User scrolls manually to Epsilon while in zen.
				view.scrollTo(rowOf(lz, "Epsilon marker"), { disableFollow: true });
				layoutScrollView(view, 80, H);

				setLook("pi");
				const lb = layoutScrollView(view, 80, H);
				expect(lb[view.scrollTop]).toContain("Epsilon marker");
			}));

		test("repeated toggles do not drift", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				view.scrollTo(rowOf(l0, "Zeta marker") - 1, { disableFollow: true });
				layoutScrollView(view, 80, H);
				const originalTop = view.scrollTop;
				const word = l0[originalTop]!.trim().split(/\s+/)[0]!;

				for (let i = 0; i < 4; i++) {
					setLook("zen");
					const lz = layoutScrollView(view, 80, H);
					expect(lz[view.scrollTop]).toContain(word);
					setLook("pi");
					layoutScrollView(view, 80, H);
					expect(view.scrollTop).toBe(originalTop);
				}
			}));

		test("collapsed tool owner falls back to the nearest previous visible owner and restores the original anchor", () =>
			withZen(() => {
				const { doc, owners } = buildDoc({ tool: true });
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const l0 = layoutScrollView(view, 80, H);
				const toolRow = rowOf(l0, "tool-output-two");
				view.scrollTo(toolRow, { disableFollow: true });
				layoutScrollView(view, 80, H);
				const originalTop = view.scrollTop;

				setLook("zen");
				const lz = layoutScrollView(view, 80, H);
				expect(lz.some((l) => l.includes("tool-output"))).toBe(false);
				// Skip spacers and use the nearest row of the preceding reply.
				const betaHeight = owners.Beta.mouseLayout.children.reduce(
					(sum: number, child: { height: number }) => sum + child.height, 0,
				);
				expect(view.scrollTop).toBe(rowOf(lz, "Beta marker") + betaHeight - 1);
				expect(lz[view.scrollTop]).toContain("widths.");
				expect(view.isFollowingEnd).toBe(false);

				setLook("pi");
				const lb = layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(originalTop);
				expect(lb[view.scrollTop]).toContain("tool-output-two");
			}));

		test("a resize anchor inside the header is recaptured at the chat boundary on a mode switch", () =>
			withZen(() => {
				const { doc } = buildDoc();
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				layoutScrollView(view, 40, H);
				view.scrollTo(1, { disableFollow: true });
				layoutScrollView(view, 40, H);
				layoutScrollView(view, 50, H);
				setLook("zen");
				const lines = layoutScrollView(view, 50, H);
				expect(lines[view.scrollTop]).toContain("Alpha marker");
			}));

		test("a hidden tool anchors to the preceding tool group's header rather than its last row", () =>
			withZen(() => {
				const { doc, chat } = buildDoc();
				const first = {
					toolName: "read",
					render: () => ["tools group header", "read result row"],
				};
				const second = {
					toolName: "read",
					render: () => look() === "zen" ? [] : ["hidden tool target"],
				};
				chat.children.splice(2, 0, first, second);
				const view = new FakeScrollView(doc, { follow: "end", primary: true });
				const before = layoutScrollView(view, 80, H);
				const originalTop = rowOf(before, "hidden tool target");
				view.scrollTo(originalTop, { disableFollow: true });
				layoutScrollView(view, 80, H);
				setLook("zen");
				const after = layoutScrollView(view, 80, H);
				expect(after[view.scrollTop]).toBe("tools group header");
				setLook("pi");
				layoutScrollView(view, 80, H);
				expect(view.scrollTop).toBe(originalTop);
			}));

		test("heavy ┃ rails are stripped when normalizing block text", () => {
			const a = analyzeBlockLines(["┃ rail text that is stable", "┃ second line"]);
			const b = analyzeBlockLines(["  rail text that is stable", "  second line"]);
			expect(a.segments.map((s: any) => s.totalChars)).toEqual(b.segments.map((s: any) => s.totalChars));
		});
	});
});
