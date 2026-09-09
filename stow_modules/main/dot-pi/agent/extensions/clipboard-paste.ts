/**
 * clipboard-paste.ts -- make Ctrl+V paste images (and text) again on macOS.
 *
 * Why this exists
 * ---------------
 * pi's built-in Ctrl+V (`app.clipboard.pasteImage`) goes through
 * `@mariozechner/clipboard`, a native addon that is `require`d at runtime from
 * either the bundle or `dirname(process.execPath)/node_modules`:
 *
 *     var clipboard = ... loadClipboardNative() : null;
 *
 * An install without `node_modules` next to the binary can never resolve that
 * addon, so the require always fails and `clipboard` is `null`. Both halves of the built-in
 * handler then silently return null -- `readClipboardImage()` because it needs
 * `clipboard.hasImage()`, and `readClipboardText()` because of `if (!clipboard)
 * return null` -- so Ctrl+V does nothing at all: no image, no text, no error.
 *
 * This extension re-implements the same behaviour with plain macOS tooling
 * (osascript for the pasteboard, sips for TIFF->PNG), which works even inside
 * pi's sandbox-exec profile.
 *
 * Precedence: extension shortcuts are consulted before built-in keybindings
 * (`Editor.handleInput` checks `onExtensionShortcut` first), and
 * `app.clipboard.pasteImage` is not in `RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS`,
 * so binding `ctrl+v` here legally shadows the broken built-in. pi prints one
 * "shortcut conflict ... Using <this file>" diagnostic on startup; that line is
 * the extension winning, not failing.
 *
 * Behaviour mirrors the built-in: an image on the clipboard is written to a
 * temp file and its path is inserted at the cursor (pi turns the path into an
 * attachment); otherwise the clipboard text is inserted.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Pasteboard flavours we can pull bytes for, in preference order. `sips` is
 * only needed for TIFF, which is what screenshots and many apps put on the
 * pasteboard when they do not also offer PNG.
 */
const IMAGE_FLAVORS = [
	{ marker: "«class PNGf»", asClass: "«class PNGf»", ext: "png", convert: false },
	{ marker: "JPEG picture", asClass: "JPEG picture", ext: "jpg", convert: false },
	{ marker: "GIF picture", asClass: "GIF picture", ext: "gif", convert: false },
	{ marker: "TIFF picture", asClass: "TIFF picture", ext: "tiff", convert: true },
] as const;

const OSASCRIPT_TIMEOUT_MS = 5000;
/** Refuse absurd payloads rather than hanging the UI on a 500MB pasteboard. */
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

function osascript(lines: string[], timeout = OSASCRIPT_TIMEOUT_MS): string | null {
	try {
		const args: string[] = [];
		for (const line of lines) {
			args.push("-e", line);
		}
		return execFileSync("osascript", args, {
			timeout,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

/** `clipboard info` lists every flavour currently on the pasteboard. */
function clipboardFlavors(): string {
	return osascript(["clipboard info"], 2000) ?? "";
}

/**
 * Copy the best available image flavour to a temp file and return its path.
 * The AppleScript `write` command emits raw bytes, so no base64 round-trip.
 */
function writeClipboardImage(): string | null {
	const flavors = clipboardFlavors();
	const flavor = IMAGE_FLAVORS.find((candidate) => flavors.includes(candidate.marker));
	if (!flavor) {
		return null;
	}

	const rawPath = join(tmpdir(), `pi-clipboard-${randomUUID()}.${flavor.ext}`);
	const ok = osascript([
		`set d to (the clipboard as ${flavor.asClass})`,
		`set fh to open for access POSIX file ${JSON.stringify(rawPath)} with write permission`,
		"write d to fh",
		"close access fh",
	]);
	if (ok === null || !existsSync(rawPath)) {
		return null;
	}

	const size = statSync(rawPath).size;
	if (size === 0 || size > MAX_IMAGE_BYTES) {
		safeUnlink(rawPath);
		return null;
	}

	if (!flavor.convert) {
		return rawPath;
	}

	// TIFF is not in pi's supported mime types; normalise to PNG like the
	// built-in convertToPng() step does.
	const pngPath = rawPath.replace(/\.tiff$/, ".png");
	try {
		execFileSync("sips", ["-s", "format", "png", rawPath, "--out", pngPath], {
			timeout: OSASCRIPT_TIMEOUT_MS,
			stdio: "ignore",
		});
	} catch {
		safeUnlink(rawPath);
		return null;
	}
	safeUnlink(rawPath);
	return existsSync(pngPath) ? pngPath : null;
}

function safeUnlink(path: string): void {
	try {
		unlinkSync(path);
	} catch {}
}

function clipboardText(): string | null {
	try {
		const text = execFileSync("pbpaste", [], {
			timeout: OSASCRIPT_TIMEOUT_MS,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			maxBuffer: 16 * 1024 * 1024,
		});
		return text.length > 0 ? text : null;
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	// Only macOS is broken in this way; elsewhere leave the built-in alone so we
	// do not shadow a working handler with a worse one.
	if (process.platform !== "darwin") {
		return;
	}

	pi.registerShortcut("ctrl+v", {
		description: "Paste image or text from clipboard",
		handler: async (ctx) => {
			const imagePath = writeClipboardImage();
			if (imagePath) {
				ctx.ui.pasteToEditor(imagePath);
				return;
			}
			const text = clipboardText();
			if (text) {
				ctx.ui.pasteToEditor(text);
				return;
			}
			ctx.ui.notify("Clipboard has no image or text", "info");
		},
	});
}
