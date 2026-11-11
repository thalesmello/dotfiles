import { type Component, Container, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";

import type { UiPart } from "./ui-claim.ts";

export type ZenColumnLayout = {
	readonly leftMargin: number;
	readonly rightMargin: number;
	readonly contentWidth: number;
};

export const MIN_TEXT_WIDTH = 80;
export const MAX_SIDE_MARGIN_RATIO = 0.2;

const WIDGET_KEY = "zen-column";
const OSC133_PREFIX = /^((?:\x1b\]133;[ABC](?:\x07|\x1b\\))+)/;

export function computeZenColumn(width: number): ZenColumnLayout {
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
		contentWidth,
	};
}

export function padZenLine(line: string, leftMargin: number): string {
	if (leftMargin <= 0 || line === "") return line;
	const pad = " ".repeat(leftMargin);
	const match = OSC133_PREFIX.exec(line);
	if (match !== null) {
		const prefix = match[1] ?? "";
		const rest = line.slice(prefix.length);
		return rest === "" ? line : `${prefix}${pad}${rest}`;
	}
	return `${pad}${line}`;
}

type WrappedComponent = {
	readonly restore: () => void;
};

function wrapRootComponent(component: Component): WrappedComponent {
	const originalRender = component.render;
	const originalHandleMouse = component.handleMouse;
	const originalInvalidate = component.invalidate;

	let cachedWidth: number | undefined;
	let cachedInnerLines: string[] | undefined;
	let cachedOutLines: string[] | undefined;

	const wrappedRender: Component["render"] = function (this: Component, width: number): string[] {
		const { leftMargin, contentWidth } = computeZenColumn(width);
		if (leftMargin <= 0) {
			return originalRender.call(this, width);
		}
		const innerLines = originalRender.call(this, contentWidth);
		if (
			cachedOutLines !== undefined &&
			cachedWidth === width &&
			cachedInnerLines === innerLines
		) {
			return cachedOutLines;
		}
		const out = innerLines.map((line) => padZenLine(line, leftMargin));
		cachedWidth = width;
		cachedInnerLines = innerLines;
		cachedOutLines = out;
		return out;
	};

	const wrappedHandleMouse: NonNullable<Component["handleMouse"]> = function (
		this: Component,
		event: TuiMouseEvent,
	): TuiMouseEventResult | undefined {
		if (typeof originalHandleMouse !== "function") return undefined;
		const { leftMargin, contentWidth } = computeZenColumn(event.width);
		if (leftMargin <= 0) {
			return originalHandleMouse.call(this, event);
		}
		const localX = event.x - leftMargin;
		if (localX < 0 || localX >= contentWidth) {
			return undefined;
		}
		return originalHandleMouse.call(this, {
			...event,
			x: localX,
			width: contentWidth,
		});
	};

	const wrappedInvalidate: Component["invalidate"] = function (this: Component): void {
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
			if (component.render === wrappedRender) component.render = originalRender;
			if (component.handleMouse === wrappedHandleMouse) component.handleMouse = originalHandleMouse;
			if (component.invalidate === wrappedInvalidate) component.invalidate = originalInvalidate;
		},
	};
}

function wrapHiddenResources(component: Component): WrappedComponent {
	const originalRender = component.render;
	const originalHandleMouse = component.handleMouse;
	const emptyRender: Component["render"] = () => [];
	const emptyMouse: NonNullable<Component["handleMouse"]> = () => undefined;

	component.render = emptyRender;
	if (typeof originalHandleMouse === "function") {
		component.handleMouse = emptyMouse;
	}

	return {
		restore: () => {
			if (component.render === emptyRender) component.render = originalRender;
			if (component.handleMouse === emptyMouse) component.handleMouse = originalHandleMouse;
		},
	};
}

type ColumnMount = {
	readonly dispose: () => void;
};

function mountZenColumn(tui: TUI): ColumnMount {
	const wrappedRoots = new Map<Component, WrappedComponent>();
	let wrappedResources: { readonly target: Component; readonly wrapper: WrappedComponent } | undefined;
	const previousRequestRender = tui.requestRender;
	let active = true;

	const syncWrappedChildren = (): void => {
		if (!active) return;
		for (const child of tui.children) {
			if (!wrappedRoots.has(child)) {
				wrappedRoots.set(child, wrapRootComponent(child));
			}
		}
		const documentContainer = tui.children[0];
		if (documentContainer instanceof Container && documentContainer.children.length >= 3) {
			const loadedResources = documentContainer.children[1];
			if (loadedResources !== undefined && wrappedResources?.target !== loadedResources) {
				wrappedResources?.wrapper.restore();
				wrappedResources = {
					target: loadedResources,
					wrapper: wrapHiddenResources(loadedResources),
				};
			}
		}
	};

	const invalidateAll = (): void => {
		for (const child of tui.children) {
			child.invalidate();
		}
		tui.invalidate();
	};

	const requestRender: TUI["requestRender"] = (force) => {
		syncWrappedChildren();
		previousRequestRender.call(tui, force);
	};

	const dispose = (): void => {
		if (!active) return;
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

export function createZenColumn(): UiPart {
	let mounted: ColumnMount | undefined;
	return {
		show: (ui) => {
			if (mounted !== undefined) return;
			ui.setWidget(WIDGET_KEY, (tui) => {
				const mount = mountZenColumn(tui);
				mounted = mount;
				return {
					render: () => [],
					invalidate: () => {},
					dispose: () => {
						mount.dispose();
						if (mounted === mount) mounted = undefined;
					},
				};
			});
		},
		hide: (ui) => {
			mounted?.dispose();
			mounted = undefined;
			ui.setWidget(WIDGET_KEY, undefined);
		},
	};
}
