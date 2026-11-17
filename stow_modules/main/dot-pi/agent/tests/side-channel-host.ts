/** Minimal, bundle-local UI substitutes; tests never mock Pi packages globally. */
export class Text {
	constructor(public text: string, ..._args: unknown[]) {}
	render(width: number): string[] {
		return this.text.split("\n").flatMap((line) => {
			const lines: string[] = [];
			for (let i = 0; i < line.length; i += Math.max(1, width)) lines.push(line.slice(i, i + Math.max(1, width)));
			return lines.length ? lines : [""];
		});
	}
	invalidate() {}
}

export class Markdown extends Text {}
export class Editor {}
export class ScrollView {}

export class Box {
	children: Array<{ render(width: number): string[]; invalidate(): void }> = [];
	constructor(..._args: unknown[]) {}
	addChild(child: { render(width: number): string[]; invalidate(): void }) { this.children.push(child); }
	render(width: number): string[] { return this.children.flatMap((child) => child.render(width)); }
	invalidate() { for (const child of this.children) child.invalidate(); }
}

export function getMarkdownTheme() { return {}; }
export function truncateToWidth(text: string, width: number) { return text.slice(0, Math.max(0, width)); }

export class BorderedLoader {
	private controller = new AbortController();
	signal = this.controller.signal;
	onAbort?: () => void;
	constructor(..._args: unknown[]) {}
	abort() { this.controller.abort(); this.onAbort?.(); }
}
