/** /codemode [on|off|status|default on|default off]
 * Session switches preserve all other tools; defaults update this machine's
 * agent settings (including the meta-dotfiles target of its settings symlink).
 */
import { join } from "node:path";
import { type ExtensionAPI, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { registerCodemodeCommand, saveCodemodeDefault } from "./lib/codemode-command.ts";

export default function (pi: ExtensionAPI) {
	const settingsPath = join(getAgentDir(), "settings.json");
	registerCodemodeCommand(pi, {
		settingsPath,
		saveDefault: (enabled) => withFileMutationQueue(settingsPath, () => saveCodemodeDefault(settingsPath, enabled)),
	});
}
