import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Minimal host stubbing @earendil-works/pi-tui classes used by smooth-scroll.ts.
const hostCode = `
export class Container {
	children: any[] = [];
	mouseLayout: any;
	renderCalls = 0;
	addChild(child: any) { this.children.push(child); }
	removeChild(child: any) {
		const idx = this.children.indexOf(child);
		if (idx >= 0) this.children.splice(idx, 1);
	}
	clear() { this.children = []; }
	invalidate() {
		for (const c of this.children) c.invalidate?.();
	}
	render(width: number): string[] {
		this.renderCalls += 1;
		const lines: string[] = [];
		const mouseChildren: any[] = [];
		for (const child of this.children) {
			const childLines = child.render ? child.render(width) : ["line"];
			mouseChildren.push({ component: child, height: childLines.length });
			lines.push(...childLines);
		}
		this.mouseLayout = { width, children: mouseChildren };
		return lines;
	}
}

export class Markdown {
	text = "";
	setText(t: string) { this.text = t; }
	invalidate() {}
}

export class Text {
	text = "";
	setText(t: string) { this.text = t; }
	invalidate() {}
}

export class ScrollView extends Container {
	child: any;
	scrollTop = 0;
	constructor(child?: any) {
		super();
		this.child = child;
	}
	getContentWidth(width: number) { return width; }
}

export class FakeWheelAccelerator {
	lines: "auto" | number = "auto";
	accelerate = true;
	lastTime = Number.NEGATIVE_INFINITY;
	lastDirection = 0;
	averageGap: number | undefined;
	carry = 0;
	next(direction: number, now: number): number {
		if (this.lines !== "auto") return this.lines;
		if (!this.accelerate) return 1;
		const gap = now - this.lastTime;
		const same = direction === this.lastDirection && gap <= 200;
		this.lastTime = now;
		this.lastDirection = direction;
		if (!same || gap < 5) return 1;
		this.averageGap = this.averageGap === undefined ? gap : (this.averageGap + gap) / 2;
		return Math.min(6, Math.max(1, Math.floor(100 / this.averageGap)));
	}
	reset() {
		this.lastTime = Number.NEGATIVE_INFINITY;
		this.lastDirection = 0;
		this.averageGap = undefined;
		this.carry = 0;
	}
}

export class TuiAltScreen {
	wheelScroll = new FakeWheelAccelerator();
	renderRequested = false;
	stopped = false;
	altScreenActive = true;
	mouseEnabled = true;
	mouseTrackingMode = 0;
	terminalWrites: string[] = [];
	terminal = {
		write: (data: string) => {
			this.terminalWrites.push(data);
			// Ghostty-style tracking: one active mode, not independent flags.
			for (const match of data.matchAll(/\\x1b\\[\\?(1000|1002|1003)([hl])/g)) {
				this.mouseTrackingMode = match[2] === "h" ? Number(match[1]) : 0;
			}
		},
	};
	beforeTerminalStart() {
		this.altScreenActive = true;
		if (this.mouseEnabled) this.terminal.write("\\x1b[?1000h\\x1b[?1002h\\x1b[?1003h\\x1b[?1006h");
	}
	routedDeltas: number[] = [];
	primaryScrollView: ScrollView;
	constructor(scrollView?: ScrollView) {
		this.primaryScrollView = scrollView ?? new ScrollView(new Container());
	}
	getPrimaryScrollView() { return this.primaryScrollView; }
	handleViewportInput(data: string): unknown {
		const match = data.match(/^\\x1b\\[<(64|65);(\\d+);(\\d+)M$/);
		if (match) {
			const button = Number(match[1]);
			const direction = button === 64 ? -1 : 1;
			this.routeWheel({ direction, button, x: Number(match[2]), y: Number(match[3]) },
				direction * this.wheelScroll.next(direction, performance.now()));
			return { consume: true };
		}
		if (data === "\\x1b[5~") {
			this.primaryScrollView.scrollTop -= 10;
			this.requestRender();
			return { consume: true };
		}
		return { consume: false, data };
	}
	emitTerminalWheel(direction: number) {
		// No SGR input reaches Pi when terminal tracking is disabled.
		if (this.mouseTrackingMode !== 0) {
			this.handleViewportInput(direction < 0 ? "\\x1b[<64;10;10M" : "\\x1b[<65;10;10M");
		}
	}
	routeWheel(_event: { direction: number; x: number; y: number; button: number }, delta: number) {
		this.routedDeltas.push(delta);
		this.primaryScrollView.scrollTop += delta;
		this.requestRender();
	}
	requestRender(_force = false) {
		this.renderRequested = true;
	}
	doRender() {
		this.renderRequested = false;
	}
}
`;

const hostPath = join(tmpdir(), `smooth-scroll-host-${process.pid}.ts`);
fs.writeFileSync(hostPath, hostCode);

const extensionPath = join(import.meta.dir, "../extensions/smooth-scroll.ts");
const extensionSource = fs.readFileSync(extensionPath, "utf8");
const redirectedSource = extensionSource
	.replaceAll('from "@earendil-works/pi-coding-agent"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`)
	.replaceAll('from "@earendil-works/pi-tui"', `from ${JSON.stringify(pathToFileURL(hostPath).href)}`);
const redirectedPath = join(tmpdir(), `smooth-scroll-ext-${process.pid}.ts`);
fs.writeFileSync(redirectedPath, redirectedSource);

afterAll(() => {
	fs.rmSync(hostPath, { force: true });
	fs.rmSync(redirectedPath, { force: true });
});

const host = await import(pathToFileURL(hostPath).href);
const extMod = await import(pathToFileURL(redirectedPath).href);

describe("smooth-scroll extension", () => {
	const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
	const commands = new Map<string, { handler: (args: string, ctx: any) => any }>();
	const notifications: string[] = [];
	const fakePi: any = {
		on(event: string, fn: any) {
			const list = handlers.get(event) ?? [];
			list.push(fn);
			handlers.set(event, list);
		},
		registerCommand(name: string, cmd: any) {
			commands.set(name, cmd);
		},
	};
	const ctx: any = {
		mode: "tui",
		ui: { notify: (msg: string) => notifications.push(msg) },
	};

	extMod.default(fakePi);

	test("switches Herdr to button-motion tracking without losing raw wheel or keyboard input", () => {
		const previous = process.env.HC_TERMINAL_ID;
		process.env.HC_TERMINAL_ID = "test-scroll";
		try {
			const screen = new host.TuiAltScreen();
			screen.beforeTerminalStart();
			expect(screen.mouseTrackingMode).toBe(1002);
			expect(screen.terminalWrites.at(-1)).toBe("\x1b[?1003l\x1b[?1002h");
			screen.emitTerminalWheel(-1);
			expect(screen.routedDeltas).toEqual([-1]);
			expect(screen.getPrimaryScrollView().scrollTop).toBe(-1);
			screen.handleViewportInput("\x1b[5~");
			expect(screen.getPrimaryScrollView().scrollTop).toBe(-11);
			// Ordinary renders/inputs should not rewrite the mouse mode.
			screen.doRender();
			expect(screen.terminalWrites.length).toBe(2);
		} finally {
			if (previous === undefined) delete process.env.HC_TERMINAL_ID;
			else process.env.HC_TERMINAL_ID = previous;
		}
	});

	test("does not enable tracking when fullscreen mouse input is disabled", () => {
		const screen = new host.TuiAltScreen();
		screen.mouseEnabled = false;
		screen.beforeTerminalStart();
		screen.doRender();
		expect(screen.terminalWrites).toEqual([]);
		expect(screen.mouseTrackingMode).toBe(0);
	});

	test("upgrades persistent patch state left by a pre-generation extension on reload", () => {
		const state = (globalThis as any)[Symbol.for("pi.smoothScroll.patchState")];
		delete state.transcriptGeneration;
		delete state.allMotionDisabledScreens;
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, ctx);
		for (const handler of handlers.get("session_start") ?? []) handler({}, ctx);
		expect(state.transcriptGeneration).toBe(1);
		expect(state.allMotionDisabledScreens).toBeInstanceOf(WeakSet);
		const screen = new host.TuiAltScreen();
		expect(() => screen.beforeTerminalStart()).not.toThrow();
		screen.emitTerminalWheel(-1);
		expect(screen.routedDeltas).toEqual([-1]);
	});

	test("normalizes coalesced ET/Herdr wheel bursts in WheelScrollAccelerator", () => {
		const screen = new host.TuiAltScreen();
		screen.handleViewportInput("");

		// Simulate 2 packets arriving 30ms apart, each with 3 coalesced wheel events (< 1ms apart).
		const steps = [
			screen.wheelScroll.next(1, 1000.0),
			screen.wheelScroll.next(1, 1000.02),
			screen.wheelScroll.next(1, 1000.04),
			screen.wheelScroll.next(1, 1030.0),
			screen.wheelScroll.next(1, 1030.02),
			screen.wheelScroll.next(1, 1030.04),
		];
		// Every event in a multi-event trackpad burst stays at 1 line instead of jumping 3-6 lines on packet boundaries.
		expect(steps).toEqual([1, 1, 1, 1, 1, 1]);
	});

	test("paces coalesced wheel events across 16ms frames and cancels immediately on direction reversal", async () => {
		const screen = new host.TuiAltScreen();
		const evDown = { direction: 1, x: 10, y: 10, button: 65 };
		const evUp = { direction: -1, x: 10, y: 10, button: 64 };

		// 4 coalesced wheel-down events arrive in a single packet before doRender runs:
		screen.routeWheel(evDown, 1);
		screen.routeWheel(evDown, 1);
		screen.routeWheel(evDown, 1);
		screen.routeWheel(evDown, 1);

		// First step renders immediately (0ms latency), rest are queued:
		expect(screen.routedDeltas).toEqual([1]);

		// Flip direction immediately: queued downward steps are cancelled and upward step fires:
		screen.doRender();
		await new Promise((r) => setTimeout(r, 10));
		screen.routeWheel(evUp, -1);
		expect(screen.routedDeltas.at(-1)).toBe(-1);

		// Drain remaining queued frames for a 3-event downward burst:
		const screen2 = new host.TuiAltScreen();
		screen2.routeWheel(evDown, 1);
		screen2.routeWheel(evDown, 1);
		screen2.routeWheel(evDown, 1);
		expect(screen2.routedDeltas).toEqual([1]);
		await new Promise((r) => setTimeout(r, 50));
		expect(screen2.routedDeltas.reduce((a: number, b: number) => a + b, 0)).toBe(3);
		expect(screen2.routedDeltas.length).toBeGreaterThanOrEqual(2);
	});

	test("caches transcript Container.render across pure scroll frames and invalidates on mutation", async () => {
		const doc = new host.Container();
		doc.addChild({ render: () => ["row-1", "row-2"] });
		const scrollView = new host.ScrollView(doc);
		const screen = new host.TuiAltScreen(scrollView);

		// Register scrollView.child and perform initial render:
		scrollView.getContentWidth(80);
		expect(doc.render(80)).toEqual(["row-1", "row-2"]);
		expect(doc.renderCalls).toBe(1);

		// Pure wheel scroll step reuses cached lines:
		screen.routeWheel({ direction: 1, x: 5, y: 5, button: 65 }, 1);
		expect(doc.render(80)).toEqual(["row-1", "row-2"]);
		// Cached lines reused without re-running child.render:
		expect(doc.renderCalls).toBe(1);

		// Non-wheel requestRender(false) (e.g. keyboard scroll, scrollbar hide timer, footer tick)
		// keeps the transcript cache intact:
		screen.requestRender(false);
		expect(doc.render(80)).toEqual(["row-1", "row-2"]);
		expect(doc.renderCalls).toBe(1);

		// Mutating or invalidating the container marks the cache dirty:
		doc.invalidate();
		expect(doc.render(80)).toEqual(["row-1", "row-2"]);
		expect(doc.renderCalls).toBe(2);
	});
});
