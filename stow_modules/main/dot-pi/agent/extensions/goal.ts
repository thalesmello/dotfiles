import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const STATE_ENTRY = "session-goal";
const STATUS_KEY = "goal";

interface GoalState {
	active: boolean;
	goal?: string;
}

interface BranchEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

function parseGoalState(data: unknown): GoalState | undefined {
	if (!data || typeof data !== "object") return undefined;
	const state = data as { active?: unknown; goal?: unknown };
	if (state.active === false) return { active: false };
	if (state.active === true && typeof state.goal === "string" && state.goal.trim()) {
		return { active: true, goal: state.goal.trim() };
	}
	return undefined;
}

function truncate(text: string, max = 60): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function goalKickoff(goal: string): string {
	return `A session-scoped goal is now active with condition: "${goal}". Briefly acknowledge the goal, then immediately start (or continue) working toward it — treat the condition itself as your directive and do not pause to ask the user what to do. The goal should remain active until the condition holds or the user clears it with \`/goal clear\`; when it holds, call \`goal_complete\`.`;
}

export default function goalCommand(pi: ExtensionAPI) {
	let activeGoal: string | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		if (activeGoal) {
			ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `goal: ${truncate(activeGoal)}`));
		} else {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	}

	function hydrate(ctx: ExtensionContext): void {
		activeGoal = undefined;
		for (const entry of ctx.sessionManager.getBranch() as BranchEntry[]) {
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
			const state = parseGoalState(entry.data);
			if (!state) continue;
			activeGoal = state.active ? state.goal : undefined;
		}
		updateStatus(ctx);
	}

	function clearGoal(ctx: ExtensionContext, notify = true): void {
		if (!activeGoal) {
			if (notify) ctx.ui.notify("No active goal", "info");
			return;
		}
		const oldGoal = activeGoal;
		activeGoal = undefined;
		pi.appendEntry(STATE_ENTRY, { active: false, clearedAt: new Date().toISOString(), goal: oldGoal });
		updateStatus(ctx);
		if (notify) ctx.ui.notify(`Goal cleared: ${oldGoal}`, "info");
	}

	pi.on("session_start", async (_event, ctx) => hydrate(ctx));
	pi.on("session_tree", async (_event, ctx) => hydrate(ctx));

	pi.on("before_agent_start", (event) => {
		if (!activeGoal) {
			delete event.systemPromptOptions.sections.session_goal;
			return;
		}

		event.systemPromptOptions.sections.session_goal = [
			`Active /goal: ${activeGoal}`,
			"",
			"The user set this as a session-scoped stop condition. Keep working toward it until the condition holds.",
			"Do not treat progress, partial investigation, or a vague next step as completion.",
			"Before ending an assistant turn, check whether the active /goal is satisfied. If not, continue with the next concrete step, or ask the user only if you are genuinely blocked and need their input.",
			"When the condition is satisfied, call the `goal_complete` tool with a short summary so the session goal can be cleared automatically.",
		].join("\n");
	});

	pi.registerTool({
		name: "goal_complete",
		label: "Goal Complete",
		description: "Mark the active /goal as satisfied. Call this only after the active session goal condition holds.",
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "Brief explanation of how the goal was satisfied" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!activeGoal) {
				return {
					content: [{ type: "text", text: "No active goal to complete." }],
					details: { active: false },
				};
			}

			const completedGoal = activeGoal;
			activeGoal = undefined;
			const details = {
				active: false,
				completedAt: new Date().toISOString(),
				goal: completedGoal,
				summary: params.summary,
			};
			pi.appendEntry(STATE_ENTRY, details);
			updateStatus(ctx);
			return {
				content: [
					{
						type: "text",
						text: `Goal complete: ${completedGoal}${params.summary ? `\nSummary: ${params.summary}` : ""}`,
					},
				],
				details,
			};
		},
	});

	pi.registerCommand("goal", {
		description: "Set a Claude-style session goal; use `/goal clear` to clear it",
		handler: async (args, ctx) => {
			const goal = args.trim();

			if (!goal) {
				ctx.ui.notify(
					activeGoal ? `Active goal: ${activeGoal}` : "Usage: /goal <condition> or /goal clear",
					"info",
				);
				return;
			}

			if (goal.toLowerCase() === "clear") {
				clearGoal(ctx);
				return;
			}

			activeGoal = goal;
			pi.appendEntry(STATE_ENTRY, { active: true, goal, setAt: new Date().toISOString() });
			updateStatus(ctx);
			ctx.ui.notify(`Goal set: ${goal}`, "info");

			const message = goalKickoff(goal);
			if (ctx.isIdle()) {
				pi.sendUserMessage(message);
			} else {
				pi.sendUserMessage(message, { deliverAs: "steer" });
			}
		},
	});
}
