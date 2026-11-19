import { Container } from "./zen-host.ts";
export { Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, stripTerminalSequences, getLanguageFromPath, highlightCode } from "./zen-host.ts";

export class Box extends Container {
	constructor(public paddingX = 0, public paddingY = 0) { super(); }
	setBgFn(_fn: unknown) {}
	setPaddingX(value: number) { this.paddingX = value; }
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
