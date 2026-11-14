/**
 * smooth-scroll.ts -- smooth 60fps wheel scrolling over Eternal Terminal (et) + Herdr.
 *
 * Why this exists
 * ---------------
 * Over `Ghostty (macOS) -> et -> herdr -> pi (fullscreen)`, two things make
 * mouse-wheel / trackpad scrolling feel choppy and slow:
 *
 * 1. `WheelScrollAccelerator` in `@earendil-works/pi-tui` assumes a non-macOS
 *    host (`process.platform === "linux"`) needs synthetic wheel acceleration
 *    up to 6 lines/event, AND has `if (gap < BURST_GAP_MS) return 1` (5ms).
 *    When `et` + `herdr` coalesce multiple SGR wheel sequences from a single
 *    trackpad swipe into one TCP/PTY read, `StdinBuffer` emits them in a
 *    synchronous loop (`gap < 0.05ms`). The first event of a packet jumps
 *    3-6 lines while the remaining events in the packet drop to 1 line and
 *    clobber `lastTime`.
 * 2. All coalesced wheel events in a packet execute `routeWheel()` before a
 *    single frame renders, collapsing e.g. 4 smooth 1-line events into one
 *    4-line jump followed by a 30-50ms network pause.
 * 3. On every scroll frame, `ScrollView` calls `documentContainer.render(width)`
 *    (`Container.prototype.render`), which has no cache and walks every
 *    component in the entire conversation history even though only `scrollTop`
 *    changed.
 *
 * What this extension does
 * ------------------------
 * - Normalizes `WheelScrollAccelerator.next()` so coalesced packet bursts
 *   (`gap < 5ms`) divide the inter-packet gap across the burst instead of
 *   oscillating between 6-line jumps and 1-line clamps.
 * - Paces coalesced wheel events in `TuiAltScreen.prototype.routeWheel`: the
 *   first step renders immediately (0ms latency), and any remaining coalesced
 *   delta from the same packet drains smoothly on a 16ms (60fps) frame timer.
 * - Caches `scrollView.child.render(width)` across pure wheel-scroll frames
 *   when width and transcript content are unchanged, making scroll frames
 *   O(viewport) instead of O(transcript).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, ScrollView, Text, TuiAltScreen } from "@earendil-works/pi-tui";

const PATCH_STATE_SYMBOL = Symbol.for("pi.smoothScroll.patchState");
const FRAME_INTERVAL_MS = 16;
const BURST_WINDOW_MS = 8;
const GESTURE_GAP_MS = 200;
const REFERENCE_GAP_MS = 60;
const MAX_BURST_AUTO_LINES = 2;

interface WheelEventLike {
	direction: number;
	x: number;
	y: number;
	button: number;
}

interface WheelScrollAcceleratorLike {
	lines: "auto" | number;
	accelerate: boolean;
	lastTime: number;
	lastDirection: number;
	averageGap?: number;
	carry: number;
	 _burstCount?: number;
	 _packetTime?: number;
	next(direction: number, now: number): number;
	reset(): void;
}

interface AltScreenLike {
	wheelScroll?: WheelScrollAcceleratorLike;
	renderRequested?: boolean;
	stopped?: boolean;
	altScreenActive?: boolean;
	currentLayout?: { primaryScrollView?: ScrollViewLike };
	getPrimaryScrollView?: () => ScrollViewLike;
	routeWheel(event: WheelEventLike, delta: number): void;
	handleViewportInput?(data: string): unknown;
	requestRender(force?: boolean): void;
	doRender(): void;
}

interface ScrollViewLike {
	child?: unknown;
	scrollTop: number;
}

interface PacerState {
	pendingDelta: number;
	lastEvent?: WheelEventLike;
	lastRouteAt: number;
	timer?: ReturnType<typeof setTimeout>;
	inPacedStep: boolean;
}

interface TranscriptCacheEntry {
	width: number;
	lines: string[];
	mouseLayout: unknown;
	dirty: boolean;
}

interface PatchState {
	installed: boolean;
	enabled: boolean;
	inPureScrollRender: boolean;
	origRouteWheel?: (this: AltScreenLike, event: WheelEventLike, delta: number) => void;
	origHandleViewportInput?: (this: AltScreenLike, data: string) => unknown;
	origRequestRender?: (this: AltScreenLike, force?: boolean) => void;
	origContainerRender?: (this: Container, width: number) => string[];
	origContainerInvalidate?: (this: Container) => void;
	origContainerAddChild?: (this: Container, component: unknown) => void;
	origContainerRemoveChild?: (this: Container, component: unknown) => void;
	origContainerClear?: (this: Container) => void;
	origMarkdownSetText?: (this: Markdown, text: string) => void;
	origMarkdownInvalidate?: (this: Markdown) => void;
	origTextSetText?: (this: Text, text: string) => void;
	origTextInvalidate?: (this: Text) => void;
	pacers: WeakMap<object, PacerState>;
	transcriptCache: WeakMap<object, TranscriptCacheEntry>;
	patchedAccelerators: WeakSet<object>;
}

function getPatchState(): PatchState {
	const holder = globalThis as unknown as Record<symbol, PatchState | undefined>;
	if (!holder[PATCH_STATE_SYMBOL]) {
		holder[PATCH_STATE_SYMBOL] = {
			installed: false,
			enabled: true,
			inPureScrollRender: false,
			pacers: new WeakMap(),
			transcriptCache: new WeakMap(),
			patchedAccelerators: new WeakSet(),
		};
	}
	return holder[PATCH_STATE_SYMBOL]!;
}

function patchAcceleratorInstance(accel: WheelScrollAcceleratorLike | undefined): void {
	if (!accel || typeof accel !== "object") return;
	const state = getPatchState();
	if (state.patchedAccelerators.has(accel)) return;
	state.patchedAccelerators.add(accel);

	const origNext = accel.next.bind(accel);
	const origReset = accel.reset.bind(accel);

	accel.next = function patchedNext(direction: number, now: number): number {
		if (!state.enabled) return origNext(direction, now);
		if (this.lines !== "auto") {
			return Number.isFinite(this.lines) ? Math.max(1, Math.floor(this.lines)) : 1;
		}
		if (!this.accelerate) return 1;

		const packetTime = this._packetTime ?? this.lastTime;
		const gapFromPacket = now - packetTime;

		// Coalesced events inside the same ET/Herdr PTY read (< 5ms apart):
		// count them toward the burst and return 1 line each so the frame pacer
		// can animate them smoothly at 60fps instead of lumping a 6-line jump
		// on the first event and 1-line clamps on the rest.
		if (direction === this.lastDirection && gapFromPacket >= 0 && gapFromPacket < 5) {
			this._burstCount = (this._burstCount ?? 1) + 1;
			this.lastTime = now;
			return 1;
		}

		const prevBurst = Math.max(1, this._burstCount ?? 1);
		this._burstCount = 1;
		this._packetTime = now;
		const sameGesture = direction === this.lastDirection && gapFromPacket <= GESTURE_GAP_MS;
		this.lastTime = now;
		this.lastDirection = direction;

		if (!sameGesture) {
			this.averageGap = undefined;
			this.carry = 0;
			return 1;
		}

		// If the previous packet was already a multi-event burst, the client
		// terminal (e.g. Ghostty on macOS) is already sending high-frequency
		// trackpad events; keep 1 line per event so we don't double-accelerate.
		if (prevBurst > 1) {
			this.averageGap = gapFromPacket / prevBurst;
			this.carry = 0;
			return 1;
		}

		const effectiveGap = gapFromPacket / prevBurst;
		this.averageGap = this.averageGap === undefined ? effectiveGap : (this.averageGap + effectiveGap) / 2;
		const lines = Math.min(MAX_BURST_AUTO_LINES, Math.max(1, REFERENCE_GAP_MS / this.averageGap)) + this.carry;
		const whole = Math.floor(lines);
		this.carry = lines - whole;
		return whole;
	};

	accel.reset = function patchedReset(): void {
		this._burstCount = 1;
		this._packetTime = Number.NEGATIVE_INFINITY;
		origReset();
	};
}

function markAllTranscriptCachesDirty(): void {
	const state = getPatchState();
	state.inPureScrollRender = false;
}

function getPacer(screen: AltScreenLike): PacerState {
	const state = getPatchState();
	let pacer = state.pacers.get(screen);
	if (!pacer) {
		pacer = {
			pendingDelta: 0,
			lastRouteAt: Number.NEGATIVE_INFINITY,
			inPacedStep: false,
		};
		state.pacers.set(screen, pacer);
	}
	return pacer;
}

function stopPacer(pacer: PacerState): void {
	if (pacer.timer !== undefined) {
		clearTimeout(pacer.timer);
		pacer.timer = undefined;
	}
	pacer.pendingDelta = 0;
}

function takeSmoothStep(pending: number): number {
	const sign = Math.sign(pending);
	const abs = Math.abs(pending);
	if (abs <= 2) return sign * 1;
	return sign * Math.max(1, Math.ceil(abs * 0.4));
}

function scheduleDrain(screen: AltScreenLike, pacer: PacerState): void {
	if (pacer.timer !== undefined) return;
	pacer.timer = setTimeout(() => {
		pacer.timer = undefined;
		const state = getPatchState();
		if (!state.installed || !state.enabled || screen.stopped || !screen.altScreenActive || pacer.pendingDelta === 0 || !pacer.lastEvent) {
			pacer.pendingDelta = 0;
			return;
		}
		const step = takeSmoothStep(pacer.pendingDelta);
		pacer.pendingDelta -= step;
		pacer.lastRouteAt = performance.now();
		pacer.inPacedStep = true;
		try {
			state.origRouteWheel!.call(screen, pacer.lastEvent, step);
		} finally {
			pacer.inPacedStep = false;
		}
		if (pacer.pendingDelta !== 0) {
			scheduleDrain(screen, pacer);
		}
	}, FRAME_INTERVAL_MS);
	pacer.timer.unref?.();
}

function installSmoothScroll(): boolean {
	const state = getPatchState();
	if (state.installed) return true;

	const altProto = TuiAltScreen.prototype as unknown as AltScreenLike;
	const containerProto = Container.prototype as unknown as Record<string, unknown>;
	const markdownProto = Markdown.prototype as unknown as Record<string, unknown>;
	const textProto = Text.prototype as unknown as Record<string, unknown>;

	if (typeof altProto.routeWheel !== "function" || typeof altProto.requestRender !== "function") {
		return false;
	}

	state.origRouteWheel = altProto.routeWheel;
	state.origHandleViewportInput = altProto.handleViewportInput;
	state.origRequestRender = altProto.requestRender;
	if (typeof state.origHandleViewportInput === "function") {
		const origHandleViewportInput = state.origHandleViewportInput;
		altProto.handleViewportInput = function patchedHandleViewportInput(this: AltScreenLike, data: string): unknown {
			patchAcceleratorInstance(this.wheelScroll);
			return origHandleViewportInput.call(this, data);
		};
	}
	state.origContainerRender = containerProto.render as (this: Container, width: number) => string[];
	state.origContainerInvalidate = containerProto.invalidate as (this: Container) => void;
	state.origContainerAddChild = containerProto.addChild as (this: Container, component: unknown) => void;
	state.origContainerRemoveChild = containerProto.removeChild as (this: Container, component: unknown) => void;
	state.origContainerClear = containerProto.clear as (this: Container) => void;
	state.origMarkdownSetText = markdownProto.setText as (this: Markdown, text: string) => void;
	state.origMarkdownInvalidate = markdownProto.invalidate as (this: Markdown) => void;
	state.origTextSetText = textProto.setText as (this: Text, text: string) => void;
	state.origTextInvalidate = textProto.invalidate as (this: Text) => void;

	altProto.requestRender = function patchedRequestRender(this: AltScreenLike, force = false): void {
		const pacer = state.pacers.get(this);
		if (force || !pacer?.inPacedStep) {
			state.inPureScrollRender = false;
			const primaryChild = this.getPrimaryScrollView?.()?.child;
			if (primaryChild && typeof primaryChild === "object") {
				const cached = state.transcriptCache.get(primaryChild);
				if (cached) cached.dirty = true;
			}
		} else {
			state.inPureScrollRender = true;
		}
		return state.origRequestRender!.call(this, force);
	};

	altProto.routeWheel = function patchedRouteWheel(this: AltScreenLike, event: WheelEventLike, delta: number): void {
		patchAcceleratorInstance(this.wheelScroll);
		if (!state.enabled || delta === 0) {
			return state.origRouteWheel!.call(this, event, delta);
		}

		const pacer = getPacer(this);
		if (pacer.inPacedStep) {
			return state.origRouteWheel!.call(this, event, delta);
		}

		// Instant direction reversal: discard any queued opposite-direction lines.
		if (pacer.pendingDelta !== 0 && Math.sign(delta) !== Math.sign(pacer.pendingDelta)) {
			stopPacer(pacer);
		}

		pacer.lastEvent = event;
		pacer.pendingDelta += delta;

		const now = performance.now();
		const inBurst = this.renderRequested === true || now - pacer.lastRouteAt < BURST_WINDOW_MS;

		if (!inBurst && pacer.timer === undefined) {
			const step = takeSmoothStep(pacer.pendingDelta);
			pacer.pendingDelta -= step;
			pacer.lastRouteAt = now;
			pacer.inPacedStep = true;
			try {
				state.origRouteWheel!.call(this, event, step);
			} finally {
				pacer.inPacedStep = false;
			}
		}

		if (pacer.pendingDelta !== 0) {
			scheduleDrain(this, pacer);
		}
	};

	containerProto.render = function patchedContainerRender(this: Container, width: number): string[] {
		if (state.enabled && state.inPureScrollRender) {
			const cached = state.transcriptCache.get(this);
			if (cached && !cached.dirty && cached.width === width) {
				(this as unknown as { mouseLayout: unknown }).mouseLayout = cached.mouseLayout;
				return cached.lines;
			}
		}
		const lines = state.origContainerRender!.call(this, width);
		const existing = state.transcriptCache.get(this);
		if (existing) {
			existing.width = width;
			existing.lines = lines;
			existing.mouseLayout = (this as unknown as { mouseLayout: unknown }).mouseLayout;
			existing.dirty = false;
		}
		return lines;
	};

	// Register the primary ScrollView's child container for scroll-frame caching.
	const scrollProto = ScrollView.prototype as unknown as {
		getContentWidth?: (width: number) => number;
		_smoothScrollOrigGetContentWidth?: (width: number) => number;
	};
	if (typeof scrollProto.getContentWidth === "function" && !scrollProto._smoothScrollOrigGetContentWidth) {
		const origGetContentWidth = scrollProto.getContentWidth;
		scrollProto._smoothScrollOrigGetContentWidth = origGetContentWidth;
		scrollProto.getContentWidth = function (this: ScrollViewLike, width: number): number {
			if (this.child && typeof this.child === "object" && !state.transcriptCache.has(this.child)) {
				state.transcriptCache.set(this.child, {
					width: -1,
					lines: [],
					mouseLayout: undefined,
					dirty: true,
				});
			}
			return origGetContentWidth.call(this, width);
		};
	}

	const dirtyHook = <T extends (...args: any[]) => any>(orig: T): T =>
		function (this: unknown, ...args: any[]) {
			markAllTranscriptCachesDirty();
			if (this && typeof this === "object") {
				const cached = state.transcriptCache.get(this);
				if (cached) cached.dirty = true;
			}
			return orig.apply(this, args);
		} as T;

	containerProto.invalidate = dirtyHook(state.origContainerInvalidate);
	containerProto.addChild = dirtyHook(state.origContainerAddChild);
	containerProto.removeChild = dirtyHook(state.origContainerRemoveChild);
	containerProto.clear = dirtyHook(state.origContainerClear);
	if (state.origMarkdownSetText) markdownProto.setText = dirtyHook(state.origMarkdownSetText);
	if (state.origMarkdownInvalidate) markdownProto.invalidate = dirtyHook(state.origMarkdownInvalidate);
	if (state.origTextSetText) textProto.setText = dirtyHook(state.origTextSetText);
	if (state.origTextInvalidate) textProto.invalidate = dirtyHook(state.origTextInvalidate);

	state.installed = true;
	return true;
}

function uninstallSmoothScroll(): void {
	const state = getPatchState();
	if (!state.installed) return;

	const altProto = TuiAltScreen.prototype as unknown as AltScreenLike;
	const containerProto = Container.prototype as unknown as Record<string, unknown>;
	const markdownProto = Markdown.prototype as unknown as Record<string, unknown>;
	const textProto = Text.prototype as unknown as Record<string, unknown>;

	if (state.origRouteWheel) altProto.routeWheel = state.origRouteWheel;
	if (state.origHandleViewportInput) altProto.handleViewportInput = state.origHandleViewportInput;
	if (state.origRequestRender) altProto.requestRender = state.origRequestRender;
	if (state.origContainerRender) containerProto.render = state.origContainerRender;
	if (state.origContainerInvalidate) containerProto.invalidate = state.origContainerInvalidate;
	if (state.origContainerAddChild) containerProto.addChild = state.origContainerAddChild;
	if (state.origContainerRemoveChild) containerProto.removeChild = state.origContainerRemoveChild;
	if (state.origContainerClear) containerProto.clear = state.origContainerClear;
	if (state.origMarkdownSetText) markdownProto.setText = state.origMarkdownSetText;
	if (state.origMarkdownInvalidate) markdownProto.invalidate = state.origMarkdownInvalidate;
	if (state.origTextSetText) textProto.setText = state.origTextSetText;
	if (state.origTextInvalidate) textProto.invalidate = state.origTextInvalidate;

	const scrollProto = ScrollView.prototype as unknown as {
		getContentWidth?: (width: number) => number;
		_smoothScrollOrigGetContentWidth?: (width: number) => number;
	};
	if (scrollProto._smoothScrollOrigGetContentWidth) {
		scrollProto.getContentWidth = scrollProto._smoothScrollOrigGetContentWidth;
		delete scrollProto._smoothScrollOrigGetContentWidth;
	}

	state.installed = false;
}

export default function smoothScrollExtension(pi: ExtensionAPI): void {
	installSmoothScroll();

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		installSmoothScroll();
	});

	pi.on("session_shutdown", () => {
		uninstallSmoothScroll();
	});

	pi.registerCommand("smooth-scroll", {
		description: "Toggle or inspect smooth 60fps wheel scroll pacing (/smooth-scroll [on|off])",
		handler: async (args: string, ctx: ExtensionContext) => {
			const state = getPatchState();
			const sub = args.trim().toLowerCase();
			if (sub === "on") state.enabled = true;
			else if (sub === "off") state.enabled = false;
			else if (sub === "toggle") state.enabled = !state.enabled;
			ctx.ui.notify(
				`smooth-scroll: ${state.enabled ? "enabled" : "disabled"} (installed: ${state.installed ? "yes" : "no"})`,
				"info",
			);
		},
	});
}
