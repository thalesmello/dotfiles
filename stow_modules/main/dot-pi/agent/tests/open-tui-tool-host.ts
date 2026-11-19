import { Container, truncateToWidth } from "./zen-host.ts";
export { Container } from "./zen-host.ts";
export { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, stripTerminalSequences, getLanguageFromPath } from "./zen-host.ts";
export const highlightRequests: { source: string; language?: string }[] = [];
export function highlightCode(source: string, language?: string): string[] {
	highlightRequests.push({ source, language });
	return source.split("\n");
}

export class Box extends Container {
	constructor(public paddingX = 0, public paddingY = 0) { super(); }
	setBgFn(_fn: unknown) {}
	setPaddingX(value: number) { this.paddingX = value; }
	render(width: number): string[] {
		const pad = " ".repeat(this.paddingX);
		return super.render(Math.max(0, width - this.paddingX * 2)).map((line) => truncateToWidth(pad + line + pad, width));
	}
	handleMouse(event: any): any {
		if (event.x < this.paddingX || event.x >= event.width - this.paddingX) return;
		return super.handleMouse({ ...event, x: event.x - this.paddingX, width: Math.max(0, event.width - this.paddingX * 2) });
	}
}
export class Spacer {
	constructor(public height = 1) {}
	render() { return Array.from({ length: this.height }, () => ""); }
	invalidate() {}
}
export const getCapabilities = () => ({ images: false });
export const getImageDimensions = () => undefined;
export const imageFallback = () => "[image]";
export const backgroundAnsi = () => "";
export const rgbColor = (r: number, g: number, b: number) => ({ r, g, b });
export const formatOsc8 = (text: string, _url: string) => text;
export const linkifyAnsiLineUrls = (text: string) => text;
export const registerKnownFilePath = (_path: string, _cwd: string) => {};
export const resolveToolPathHyperlinkUrl = (path: string) => path ? `file://${path}` : undefined;
