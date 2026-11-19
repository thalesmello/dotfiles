/** /codemode [on|off|only|status|default on|default off|default only]
 * Session switches preserve all other tools; defaults update this machine's
 * agent settings (including the meta-dotfiles target of its settings symlink).
 */
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { registerCodemodeCommand, saveCodemodeDefault } from "./lib/codemode-command.ts";
import { createCodemodePicker, type CodemodePick } from "./lib/codemode-picker.ts";

export default function (pi: ExtensionAPI) {
	const settingsPath = join(getAgentDir(), "settings.json");
	registerCodemodeCommand(pi, {
		settingsPath,
		pick: (ctx, current) => ctx.ui.custom<CodemodePick | undefined>((tui, theme, keybindings, done) => createCodemodePicker(current, {
			matches: (data, action) => keybindings.matches(data, action),
			isSaveKey: (data) => matchesKey(data, "ctrl+s"),
			fg: (color, text) => theme.fg(color, text),
			truncate: truncateToWidth,
			requestRender: () => tui.requestRender(),
			done,
		}), { blocked: { kind: "question", message: "Choose codemode or save its default" } }),
		saveDefault: (enabled, mode) => withFileMutationQueue(settingsPath, () => saveCodemodeDefault(settingsPath, enabled, mode)),
		saveMode: (mode) => withFileMutationQueue(settingsPath, () => saveCodemodeDefault(settingsPath, undefined, mode)),
	});
}
