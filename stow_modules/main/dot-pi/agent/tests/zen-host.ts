/**
 * Test host for zen.test.ts.
 *
 * Provides the @earendil-works/pi-tui and @earendil-works/pi-coding-agent
 * runtime surfaces used by the zen extension.
 */
import { realUtils } from "./selection-manager-host.ts";

export const { visibleWidth, sliceByColumn, stripTerminalSequences } = realUtils;

export function truncateToWidth(text: string, maxWidth: number, ellipsis = "..."): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(text) <= maxWidth) return text;
	const ellipsisWidth = visibleWidth(ellipsis);
	const room = Math.max(0, maxWidth - ellipsisWidth);
	return `${sliceByColumn(text, 0, room, true)}${ellipsis.slice(0, maxWidth - room)}`;
}

export function wrapTextWithAnsi(text: string, width: number): string[] {
	const safeWidth = Math.max(1, Math.floor(width));
	return text.split("\n").flatMap((line) => {
		if (visibleWidth(line) <= safeWidth) return [line];
		const words = line.split(" ");
		const rows: string[] = [];
		let current = "";
		for (const word of words) {
			const candidate = current === "" ? word : `${current} ${word}`;
			if (visibleWidth(candidate) <= safeWidth) {
				current = candidate;
			} else {
				if (current !== "") rows.push(current);
				current = word;
			}
		}
		if (current !== "") rows.push(current);
		return rows.length > 0 ? rows : [""];
	});
}

export class Container {
	children: any[] = [];
	mouseLayout?: { width: number; children: Array<{ component: any; height: number }> };

	addChild(child: any): void {
		this.children.push(child);
	}

	removeChild(child: any): void {
		const idx = this.children.indexOf(child);
		if (idx >= 0) this.children.splice(idx, 1);
	}

	clear(): void {
		this.children = [];
	}

	invalidate(): void {
		for (const child of this.children) {
			child.invalidate?.();
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const mouseChildren: Array<{ component: any; height: number }> = [];
		for (const child of this.children) {
			const childLines = child.render(width);
			mouseChildren.push({ component: child, height: childLines.length });
			lines.push(...childLines);
		}
		this.mouseLayout = { width, children: mouseChildren };
		return lines;
	}

	handleMouse(event: any): any {
		if (event.y < 0 || event.y >= event.height) return undefined;
		const mouseChildren =
			this.mouseLayout?.width === event.width
				? this.mouseLayout.children
				: this.children.map((component) => ({ component, height: component.render(event.width).length }));
		let childY = 0;
		for (const { component: child, height: childHeight } of mouseChildren) {
			if (event.y >= childY && event.y < childY + childHeight) {
				return child.handleMouse?.({
					...event,
					y: event.y - childY,
					height: childHeight,
				});
			}
			childY += childHeight;
		}
		return undefined;
	}
}

export class Box extends Container {
	constructor(
		public paddingX = 0,
		public paddingY = 0,
		public bgFn?: (text: string) => string,
	) {
		super();
	}
}

export class Text {
	constructor(
		public text = "",
		public paddingX = 0,
		public paddingY = 0,
	) {}
	setText(text: string): void {
		this.text = text;
	}
	invalidate(): void {}
	render(width: number): string[] {
		const pad = " ".repeat(this.paddingX);
		return this.text.split("\n").map((line) => truncateToWidth(`${pad}${line}`, width));
	}
}

export class Markdown {
	constructor(
		public text: string,
		public paddingX = 0,
		public paddingY = 0,
		public theme?: any,
		public defaultStyle?: any,
		public options?: any,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const room = Math.max(1, width - this.paddingX * 2);
		const pad = " ".repeat(this.paddingX);
		return wrapTextWithAnsi(this.text, room).map((line) => `${pad}${line}`);
	}
}

export class MouseRegion {
	constructor(
		public child: any,
		public handler: (event: any) => any,
	) {}
	invalidate(): void {
		this.child.invalidate?.();
	}
	render(width: number): string[] {
		return this.child.render(width);
	}
	handleMouse(event: any): any {
		return this.handler(event) ?? this.child.handleMouse?.(event);
	}
}

export class CustomEditor {
	private paddingX: number;
	private text = "";
	readonly history: string[] = [];
	borderColor = (glyph: string) => glyph;

	constructor(_tui?: any, _theme?: any, _keybindings?: any, options?: { paddingX?: number }) {
		this.paddingX = options?.paddingX ?? 2;
	}

	getPaddingX(): number {
		return this.paddingX;
	}

	setPaddingX(padding: number): void {
		this.paddingX = padding;
	}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
	}

	addToHistory(text: string): void {
		this.history.push(text);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const pad = " ".repeat(this.paddingX);
		const border = "─".repeat(Math.max(1, width));
		return [border, `${pad}${this.text}`, border];
	}
}

export class AssistantMessageComponent extends Container {
	hidden = false;
	setHideThinkingBlock(hide: boolean): void {
		this.hidden = hide;
	}
}

export function getAgentDir(): string {
	return "/tmp/pi-zen-test-agent";
}

export function sessionEntryToContextMessages(entry: any): any[] {
	return entry?.messages ?? [];
}

export class SettingsManager {
	static create(_cwd?: string, _agentDir?: string): SettingsManager {
		return new SettingsManager();
	}
	getHideThinkingBlock(): boolean {
		return false;
	}
	getGlobalSettings(): { quietStartup?: boolean } {
		return {};
	}
	drainErrors(): any[] {
		return [];
	}
	setQuietStartup(_value: boolean): void {}
	async flush(): Promise<void> {}
}

export function getLanguageFromPath(path: string): string | undefined {
	if (path.endsWith(".ts")) return "typescript";
	if (path.endsWith(".js")) return "javascript";
	return undefined;
}

export function highlightCode(code: string, _lang?: string): string[] {
	return code.split("\n");
}

export function getMarkdownTheme(): any {
	const id = (s: string) => s;
	return {
		heading: id,
		link: id,
		linkUrl: id,
		code: id,
		codeBlock: id,
		codeBlockBorder: id,
		quote: id,
		quoteBorder: id,
		hr: id,
		listBullet: id,
		bold: id,
		italic: id,
		strikethrough: id,
		underline: id,
	};
}
