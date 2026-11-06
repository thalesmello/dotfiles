import { A as RULE_LISTS, C as DEFAULTS_ENTRY, D as PRESET_DEFAULTS, E as FOLLOW_UP_REVIEW_MODES, M as parseConfigFile, N as validateConfigFile, O as PRESET_NAMES, P as approximateTokens, S as CONFIG_SCHEMA_URL, T as EXTENSION_ID, _ as BUILT_IN_RULES, a as buildUserPrompt, b as CODEX_AUTO_REVIEW_MODEL, c as POLICY_REVISION$1, d as parseVerdict, f as renderTranscript, g as buildReviewMessage, h as buildFollowUpMessage, j as mergeConfig, k as REASONING_LEVELS, l as buildSystemPrompt$1, m as THINKING_PROMPT, n as renderTranscript$1, o as BUILT_IN_RULES$1, p as findToolCallInput, r as buildFollowUpPrompt, t as parseReviewAssessment, u as parseFastVerdict, v as POLICY_REVISION, w as DEFAULT_CONFIG, x as CODEX_PROVIDER, y as buildSystemPrompt } from "./verdict-qZO-VQH0.js";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { calculateContextTokens, getAgentDir } from "@earendil-works/pi-coding-agent";
import { PERMISSIONS_READY_CHANNEL, getPermissionsService } from "../src/service.ts";
import { clampThinkingLevel, isRetryableAssistantError } from "@earendil-works/pi-ai";

// src/reviewer/model-call.ts
const FIRST_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 3e4;
/** Room left for reasoning and the verdict when a prompt is admitted; pi-ai keeps its own margin on top */
const OUTPUT_RESERVE_TOKENS = 16384;
const SESSION_KEY_PREFIX = "auto-review:";
function abortError() {
	const error = /* @__PURE__ */ new Error("operation aborted");
	error.name = "AbortError";
	return error;
}
/** Resolves early on abort; the caller checks the signal */
async function sleep(milliseconds, signal) {
	const { promise, resolve } = Promise.withResolvers();
	const onAbort = () => resolve();
	const timer = setTimeout(resolve, milliseconds);
	signal.addEventListener("abort", onAbort, { once: true });
	await promise;
	clearTimeout(timer);
	signal.removeEventListener("abort", onAbort);
}
/** A provider is not bound to honour the abort signal promptly, so the timeout is enforced here */
async function raceWithSignal(promise, signal) {
	if (signal.aborted) throw abortError();
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(abortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
/** Retrying any other failure fails the same way, and resending a refused request draws another refusal */
function isTransient(reply) {
	return reply.rawStopReason !== "refusal" && isRetryableAssistantError(reply);
}
function replyText(message) {
	return message.content.flatMap((block) => block.type === "text" ? block.text : []).join("").trim();
}
function createModelCall(options) {
	const { registry, model, config, signal, timeoutSignal, deadline, usage } = options;
	const attemptTimeoutMs = config.attemptTimeoutMs ?? config.timeoutMs;
	const aborted = () => ({
		ok: false,
		failure: timeoutSignal.aborted ? "timeout" : "cancelled"
	});
	return async (request, parse) => {
		if (signal.aborted) return aborted();
		if (request.tokens + 16384 > model.contextWindow) return {
			ok: false,
			failure: "input-budget-exceeded"
		};
		const reasoning = clampThinkingLevel(model, request.reasoning);
		for (let attempt = 0;; attempt += 1) {
			const attemptController = new AbortController();
			const attemptTimeout = setTimeout(() => attemptController.abort(), attemptTimeoutMs);
			const attemptSignal = AbortSignal.any([signal, attemptController.signal]);
			let failure = "provider-error";
			try {
				const reply = await raceWithSignal(registry.streamSimple(model, {
					systemPrompt: request.systemPrompt,
					messages: request.messages
				}, {
					maxRetries: 0,
					signal: attemptSignal,
					timeoutMs: Math.max(1, Math.min(attemptTimeoutMs, deadline - Date.now())),
					sessionId: `${SESSION_KEY_PREFIX}${options.sessionId}`,
					...reasoning === "off" ? {} : { reasoning },
					...request.maxTokens === void 0 ? {} : { maxTokens: request.maxTokens }
				}).result(), attemptSignal);
				usage.input += reply.usage.input;
				usage.cacheRead += reply.usage.cacheRead;
				usage.output += reply.usage.output;
				if (reply.stopReason === "error" && !isTransient(reply)) return {
					ok: false,
					failure: "provider-error"
				};
				if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage ?? reply.stopReason);
				failure = "invalid-response";
				return {
					ok: true,
					value: parse(replyText(reply)),
					reply
				};
			} catch {
				if (signal.aborted) return aborted();
				if (attempt >= config.maxRetries) return {
					ok: false,
					failure: attemptController.signal.aborted ? "attempt-timeout" : failure
				};
			} finally {
				clearTimeout(attemptTimeout);
			}
			await sleep(Math.min(FIRST_RETRY_DELAY_MS * 4 ** attempt, MAX_RETRY_DELAY_MS), signal);
			if (signal.aborted) return aborted();
		}
	};
}

// src/reviewer/conversation.ts
/** Past this a conversation starts over even where the context window holds more, since every review rereads it */
const MAX_CONVERSATION_TOKENS = 256e3;
function userMessage(content) {
	return {
		role: "user",
		content,
		timestamp: Date.now()
	};
}
/**
* A follow-up while the conversation still lies on the branch and has room for it, otherwise a full review; `render`
* builds the review's message, and gets no continuation for a full one
*/
function prepareReview(input, options, render) {
	const { conversation, branch, contextWindow } = input;
	const entryIndex = conversation === void 0 ? -1 : branch.findIndex((entry) => entry.id === conversation.cursor.entryId);
	if (conversation !== void 0 && entryIndex >= 0) {
		const followUp = render({
			cursor: conversation.cursor,
			entryIndex
		});
		const tokens = conversation.tokens + approximateTokens(followUp.content);
		if (tokens + 16384 <= Math.min(contextWindow, MAX_CONVERSATION_TOKENS)) return {
			request: {
				...options,
				messages: [...conversation.messages, userMessage(followUp.content)],
				tokens
			},
			transcript: followUp.transcript,
			priorReviews: conversation.reviews
		};
	}
	const full = render(void 0);
	return {
		request: {
			...options,
			messages: [userMessage(full.content)],
			tokens: approximateTokens(options.systemPrompt + full.content)
		},
		transcript: full.transcript,
		priorReviews: 0
	};
}
/** In `auto`, a follow-up served without a cache hit ends the conversation, which an uncached provider would resend whole */
function nextConversation(config, review) {
	if (!(config.followUpReviews === "always" || config.followUpReviews === "auto" && (review.priorReviews === 0 || review.firstReply.usage.cacheRead > 0)) || review.cursor === void 0) return;
	return {
		messages: [...review.request.messages, review.lastReply],
		cursor: review.cursor,
		tokens: calculateContextTokens(review.lastReply.usage) || review.request.tokens + approximateTokens(replyText(review.lastReply)),
		reviews: review.priorReviews + 1
	};
}

// src/presets/claude-code/denial-counter.ts
const MAX_CONSECUTIVE_DENIALS$1 = 3;
const MAX_TOTAL_DENIALS = 20;
/** Hands the denial that reaches a limit to the human prompt, then counts that limit afresh */
var DenialCounter = class {
	consecutiveDenials = 0;
	totalDenials = 0;
	refusal() {}
	recordDenial() {
		this.consecutiveDenials += 1;
		this.totalDenials += 1;
		const totalReached = this.totalDenials >= MAX_TOTAL_DENIALS;
		const consecutiveReached = this.consecutiveDenials >= MAX_CONSECUTIVE_DENIALS$1;
		if (totalReached) this.totalDenials = 0;
		if (consecutiveReached) this.consecutiveDenials = 0;
		return totalReached ? "total" : consecutiveReached ? "consecutive" : void 0;
	}
	recordNonDenial() {
		this.consecutiveDenials = 0;
	}
	resetTurn() {}
};

// src/presets/claude-code/preset.ts
const FAST_MAX_TOKENS = 1024;
const DENIAL_GUIDANCE = "Do not reach the same result another way, such as by rewording, splitting or encoding the action or running it through another tool. Carry on with work that does not depend on it; if it is essential, stop and tell the user what you need and why, so they can approve it.";
const CLAUDE_CODE_PRESET = {
	policyRevision: POLICY_REVISION,
	builtInRules: BUILT_IN_RULES,
	createLimiter: () => new DenialCounter(),
	async review(input, complete) {
		const { config, branch, details, contextFiles } = input;
		const systemPrompt = buildSystemPrompt(config.autoMode, contextFiles);
		const { request: fastRequest, transcript, priorReviews } = prepareReview(input, {
			systemPrompt,
			reasoning: "off",
			maxTokens: FAST_MAX_TOKENS
		}, (after) => {
			const rendered = renderTranscript(branch, details, after?.cursor);
			return {
				content: after === void 0 ? buildReviewMessage(rendered) : buildFollowUpMessage(rendered),
				transcript: rendered
			};
		});
		const fields = {
			...transcript.stats,
			contextFileCount: contextFiles.length,
			priorReviews
		};
		const fast = await complete(fastRequest, parseFastVerdict);
		if (!fast.ok) return {
			kind: "failed",
			failure: fast.failure,
			fields
		};
		const conversationAfter = (request, lastReply) => nextConversation(config, {
			priorReviews,
			request,
			firstReply: fast.reply,
			lastReply,
			cursor: transcript.cursor
		});
		if (fast.value === "allow") return {
			kind: "allow",
			fields: {
				...fields,
				stage: "fast"
			},
			conversation: conversationAfter(fastRequest, fast.reply)
		};
		const thinkingRequest = {
			systemPrompt,
			messages: [
				...fastRequest.messages,
				fast.reply,
				userMessage(THINKING_PROMPT)
			],
			tokens: fastRequest.tokens + approximateTokens(replyText(fast.reply) + THINKING_PROMPT),
			reasoning: config.reasoning
		};
		const escalated = {
			...fields,
			stage: "thinking",
			fastVerdict: fast.value
		};
		const thinking = await complete(thinkingRequest, parseVerdict);
		if (!thinking.ok) return {
			kind: "failed",
			failure: thinking.failure,
			fields: escalated
		};
		const next = conversationAfter(thinkingRequest, thinking.reply);
		const verdict = thinking.value;
		if (verdict.outcome === "allow") return {
			kind: "allow",
			fields: escalated,
			conversation: next
		};
		return {
			kind: "deny",
			reason: `${verdict.reason} ${DENIAL_GUIDANCE}`,
			fields: {
				...escalated,
				category: verdict.category
			},
			conversation: next
		};
	}
};

// src/presets/codex/circuit-breaker.ts
const MAX_CONSECUTIVE_DENIALS = 3;
const RECENT_WINDOW_SIZE = 50;
const MAX_RECENT_DENIALS = 10;
const REFUSAL = "Too many denials this turn; further requests are refused unreviewed until the next turn. Ask the user for explicit approval before retrying";
var DenialCircuitBreaker = class {
	consecutiveDenials = 0;
	recentDenials = [];
	refusal() {
		return this.consecutiveDenials >= MAX_CONSECUTIVE_DENIALS || this.recentDenials.filter(Boolean).length >= MAX_RECENT_DENIALS ? REFUSAL : void 0;
	}
	recordDenial() {
		this.consecutiveDenials += 1;
		this.recordRecent(true);
	}
	recordNonDenial() {
		this.consecutiveDenials = 0;
		this.recordRecent(false);
	}
	resetTurn() {
		this.consecutiveDenials = 0;
		this.recentDenials = [];
	}
	recordRecent(denied) {
		this.recentDenials.push(denied);
		if (this.recentDenials.length > RECENT_WINDOW_SIZE) this.recentDenials.shift();
	}
};

// src/presets/codex/preset.ts
const REJECTION_INSTRUCTIONS = "The agent must not attempt to achieve the same outcome via workaround, indirect execution, or policy circumvention. Proceed only with a materially safer alternative, or if the user explicitly approves the action after being informed of the risk. Otherwise, stop and request user input";
const CODEX_PRESET = {
	policyRevision: POLICY_REVISION$1,
	builtInRules: BUILT_IN_RULES$1,
	createLimiter: () => new DenialCircuitBreaker(),
	async review(input, complete) {
		const { config, branch, details } = input;
		const toolInput = findToolCallInput(branch, details.toolCallId);
		const { request, transcript, priorReviews } = prepareReview(input, {
			systemPrompt: buildSystemPrompt$1(config),
			reasoning: config.reasoning
		}, (after) => {
			if (after === void 0) {
				const full = renderTranscript$1(branch);
				return {
					content: buildUserPrompt(full, details, toolInput),
					transcript: full
				};
			}
			const delta = renderTranscript$1(branch, after.entryIndex + 1);
			return {
				content: buildFollowUpPrompt(delta, details, toolInput),
				transcript: delta
			};
		});
		const fields = {
			toolInputIncluded: toolInput !== void 0,
			...transcript.stats,
			priorReviews
		};
		const result = await complete(request, parseReviewAssessment);
		if (!result.ok) return {
			kind: "failed",
			failure: result.failure,
			fields
		};
		const assessment = result.value;
		const lastEntry = branch.at(-1);
		const next = nextConversation(config, {
			priorReviews,
			request,
			firstReply: result.reply,
			lastReply: result.reply,
			cursor: lastEntry === void 0 ? void 0 : { entryId: lastEntry.id }
		});
		const graded = {
			...fields,
			riskLevel: assessment.riskLevel,
			userApproval: assessment.userAuthorization
		};
		if (assessment.outcome === "allow") return {
			kind: "allow",
			fields: graded,
			conversation: next
		};
		return {
			kind: "deny",
			reason: `${assessment.rationale} (risk: ${assessment.riskLevel}, user authorization: ${assessment.userAuthorization}). ${REJECTION_INSTRUCTIONS}`,
			fields: graded,
			conversation: next
		};
	}
};

// src/presets/presets.ts
const PRESETS = {
	codex: CODEX_PRESET,
	"claude-code": CLAUDE_CODE_PRESET
};

// src/config/store.ts
function describeError$1(error) {
	return error instanceof Error ? error.message : String(error);
}
function configPath(cwd, scope) {
	return scope === "global" ? join(getAgentDir(), "extensions", EXTENSION_ID, "config.json") : join(cwd, ".pi", "extensions", EXTENSION_ID, "config.json");
}
function readSource(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
}
function readScope(cwd, scope) {
	const path = configPath(cwd, scope);
	let source;
	try {
		source = readSource(path);
	} catch (error) {
		return {
			scope,
			cwd,
			path,
			source: void 0,
			valid: false,
			issue: describeError$1(error)
		};
	}
	if (source === void 0) return {
		scope,
		cwd,
		path,
		source,
		valid: true,
		config: {}
	};
	const parsed = parseConfigFile(source);
	return parsed.ok ? {
		scope,
		cwd,
		path,
		source,
		valid: true,
		config: parsed.config
	} : {
		scope,
		cwd,
		path,
		source,
		valid: false,
		issue: parsed.issue
	};
}
/** The scope as it takes part in the merge: an untrusted project's file is left unread, so it can neither loosen nor break the config */
function readActiveScope(cwd, scope, projectTrusted) {
	return scope === "project" && !projectTrusted ? {
		scope,
		cwd,
		path: configPath(cwd, scope),
		source: void 0,
		valid: true,
		config: {}
	} : readScope(cwd, scope);
}
function merge(global, project) {
	if (!global.valid || !project.valid) return {
		config: void 0,
		issues: [global, project].flatMap((snapshot) => snapshot.valid ? [] : `${snapshot.path}: ${snapshot.issue}`)
	};
	return {
		config: mergeConfig(global.config, project.config),
		issues: []
	};
}
function loadConfig(cwd, projectTrusted) {
	return merge(readScope(cwd, "global"), readActiveScope(cwd, "project", projectTrusted));
}
function checkForConflict(snapshot) {
	let current;
	try {
		current = readSource(snapshot.path);
	} catch (error) {
		return `Failed to re-read config at '${snapshot.path}': ${describeError$1(error)}`;
	}
	return current === snapshot.source ? void 0 : `Config at '${snapshot.path}' changed while it was being edited; reopen the command and try again.`;
}
function saveScope(snapshot, draft, projectTrusted) {
	if (!snapshot.valid) return {
		ok: false,
		message: `Cannot save invalid config at '${snapshot.path}': ${snapshot.issue}`
	};
	const validated = validateConfigFile(draft);
	if (!validated.ok) return {
		ok: false,
		message: `${snapshot.path}: ${validated.issue}`
	};
	const { $schema = CONFIG_SCHEMA_URL, ...fields } = validated.config;
	const config = {
		$schema,
		...fields
	};
	const source = `${JSON.stringify(config, null, 2)}\n`;
	const replacement = {
		...snapshot,
		source,
		config
	};
	const other = readActiveScope(snapshot.cwd, snapshot.scope === "global" ? "project" : "global", projectTrusted);
	const loadResult = snapshot.scope === "global" ? merge(replacement, other) : merge(other, replacement);
	if (loadResult.config === void 0) return {
		ok: false,
		message: loadResult.issues.join("\n")
	};
	const conflict = checkForConflict(snapshot);
	if (conflict !== void 0) return {
		ok: false,
		message: conflict
	};
	const temporary = `${snapshot.path}.tmp`;
	try {
		mkdirSync(dirname(snapshot.path), { recursive: true });
		writeFileSync(temporary, source, "utf8");
		renameSync(temporary, snapshot.path);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {}
		return {
			ok: false,
			message: `Failed to save config at '${snapshot.path}': ${describeError$1(error)}`
		};
	}
	return {
		ok: true,
		loadResult
	};
}
function resetScope(snapshot, projectTrusted) {
	if (!snapshot.valid && snapshot.source === void 0) return {
		ok: false,
		message: `Cannot reset unreadable config at '${snapshot.path}': ${snapshot.issue}`
	};
	const conflict = checkForConflict(snapshot);
	if (conflict !== void 0) return {
		ok: false,
		message: conflict
	};
	if (snapshot.source !== void 0) try {
		unlinkSync(snapshot.path);
	} catch (error) {
		return {
			ok: false,
			message: `Failed to reset config at '${snapshot.path}': ${describeError$1(error)}`
		};
	}
	return {
		ok: true,
		loadResult: loadConfig(snapshot.cwd, projectTrusted)
	};
}

// src/config/command.ts
const COMMAND_NAME = "permission-auto-review";
const USAGE = `Usage: /${COMMAND_NAME} [show|path|defaults|reset [global|project]|help]`;
const INHERIT = "Use inherited value";
const CUSTOM = "Enter custom value...";
const EDIT_RULES = "Edit rules...";
const VALUE_PREFIX = "Value: ";
const SAVE = "Save changes";
const CANCEL = "Cancel";
const WHITESPACE = /\s+/;
const PARAGRAPH_BREAK = /\n\s*\n/;
const HEADING_MARK = /^#+\s*/;
const LABEL_END = /[[:]/;
const MAX_LABEL_LENGTH = 60;
function withField(draft, field, value) {
	const { [field]: _removed, ...rest } = draft;
	return value === void 0 ? rest : {
		...draft,
		[field]: value
	};
}
function withRules(draft, list, rules) {
	const { autoMode: { [list]: _removed, ...others } = {}, ...rest } = draft;
	const autoMode = rules === void 0 ? others : {
		...others,
		[list]: rules
	};
	return Object.keys(autoMode).length === 0 ? rest : {
		...rest,
		autoMode
	};
}
function editString(field, title, known) {
	return async (ctx, draft, effective) => {
		const current = effective[field];
		const values = [.../* @__PURE__ */ new Set([...known(effective, ctx), current])].toSorted((left, right) => left.localeCompare(right));
		const selected = await ctx.ui.select(title, [
			INHERIT,
			...values.map((value) => `${VALUE_PREFIX}${value}`),
			CUSTOM
		]);
		if (selected === INHERIT) return withField(draft, field, void 0);
		if (selected === CUSTOM) {
			const custom = (await ctx.ui.input(title, current))?.trim();
			return custom === void 0 || custom === "" ? draft : withField(draft, field, custom);
		}
		return selected?.startsWith(VALUE_PREFIX) === true ? withField(draft, field, selected.slice(7)) : draft;
	};
}
function editChoice(field, title, choices) {
	return async (ctx, draft) => {
		const selected = await ctx.ui.select(title, [INHERIT, ...choices]);
		if (selected === INHERIT) return withField(draft, field, void 0);
		const choice = choices.find((candidate) => candidate === selected);
		return choice === void 0 ? draft : withField(draft, field, choice);
	};
}
function editInteger(field, title, prompt) {
	return async (ctx, draft, effective) => {
		const selected = await ctx.ui.select(title, [INHERIT, CUSTOM]);
		if (selected === INHERIT) return withField(draft, field, void 0);
		const input = selected === void 0 ? void 0 : (await ctx.ui.input(prompt, String(effective[field] ?? "")))?.trim();
		if (input === void 0 || input === "") return draft;
		const value = Number(input);
		const validated = validateConfigFile({ [field]: value });
		if (!validated.ok) {
			ctx.ui.notify(validated.issue, "warning");
			return draft;
		}
		return withField(draft, field, value);
	};
}
function editRules(list, title) {
	return async (ctx, draft, effective) => {
		const selected = await ctx.ui.select(title, [EDIT_RULES, INHERIT]);
		if (selected === INHERIT) return withRules(draft, list, void 0);
		const text = selected === void 0 ? void 0 : await ctx.ui.editor(`${title}: one rule per paragraph, and ${DEFAULTS_ENTRY} for the built-in ones`, effective.autoMode[list].join("\n\n"));
		if (text === void 0) return draft;
		return withRules(draft, list, text.split(PARAGRAPH_BREAK).map((rule) => rule.trim()).filter((rule) => rule !== ""));
	};
}
function formatMilliseconds(value) {
	return `${value} ms`;
}
/** The lists' rules stay out of the menu and `show`, like any policy text */
function summarizeRules(rules) {
	const custom = rules.filter((rule) => rule !== DEFAULTS_ENTRY).length;
	const parts = [...rules.includes("$defaults") ? [DEFAULTS_ENTRY] : [], ...custom > 0 ? [`${custom} custom`] : []];
	return parts.length > 0 ? parts.join(" + ") : "none";
}
function fieldSetting(field, label, edit, format = String) {
	return {
		key: field,
		label,
		isSetIn: (file) => Object.hasOwn(file, field),
		format: (config) => {
			const value = config[field];
			return value === void 0 ? "not set" : format(value);
		},
		edit
	};
}
function ruleSetting(list, label) {
	return {
		key: `autoMode.${list}`,
		label,
		isSetIn: (file) => file.autoMode !== void 0 && Object.hasOwn(file.autoMode, list),
		format: (config) => summarizeRules(config.autoMode[list]),
		edit: editRules(list, `Configure ${label}`)
	};
}
const PRESET_DEFAULT_VALUES = Object.values(PRESET_DEFAULTS);
const SETTINGS = [
	fieldSetting("preset", "Preset", editChoice("preset", "Configure Preset", PRESET_NAMES)),
	fieldSetting("provider", "Provider", editString("provider", "Configure Provider", (_effective, ctx) => [...ctx.modelRegistry.getAll().map((model) => model.provider), ...PRESET_DEFAULT_VALUES.map((defaults) => defaults.provider)])),
	fieldSetting("model", "Model", editString("model", "Configure Model", (effective, ctx) => [...ctx.modelRegistry.getAll().filter((model) => model.provider === effective.provider).map((model) => model.id), ...PRESET_DEFAULT_VALUES.filter((defaults) => defaults.provider === effective.provider).map((defaults) => defaults.model)])),
	fieldSetting("reasoning", "Reasoning", editChoice("reasoning", "Configure Reasoning", REASONING_LEVELS)),
	fieldSetting("timeoutMs", "Timeout", editInteger("timeoutMs", "Configure Timeout", "Timeout in milliseconds"), formatMilliseconds),
	fieldSetting("maxRetries", "Retries", editInteger("maxRetries", "Configure Retries", "Retries after the first call")),
	fieldSetting("attemptTimeoutMs", "Attempt timeout", editInteger("attemptTimeoutMs", "Configure Attempt Timeout", "Attempt timeout in milliseconds"), formatMilliseconds),
	fieldSetting("followUpReviews", "Follow-up reviews", editChoice("followUpReviews", "Configure Follow-up Reviews", FOLLOW_UP_REVIEW_MODES)),
	ruleSetting("environment", "Environment"),
	ruleSetting("allow", "Allow rules"),
	ruleSetting("soft_deny", "Soft deny rules"),
	ruleSetting("hard_deny", "Hard deny rules")
];
function originOf(layers, setting) {
	if (setting.isSetIn(layers.project)) return "project";
	return setting.isSetIn(layers.global) ? "global" : "default";
}
/** A built-in rule's name: its first line up to a `[` or `:`, without a Markdown heading mark */
function ruleLabel(rule) {
	const label = ((rule.split("\n", 1)[0] ?? "").replace(HEADING_MARK, "").split(LABEL_END, 1)[0] ?? "").trim();
	return label.length > MAX_LABEL_LENGTH ? `${label.slice(0, 59)}…` : label;
}
async function chooseScope(ctx, title) {
	const selected = await ctx.ui.select(title, ["Global configuration", "Project configuration"]);
	if (selected === void 0) return;
	return selected === "Global configuration" ? "global" : "project";
}
function notifyActivation(ctx, activation, messages) {
	if (activation.kind === "failed") ctx.ui.notify(`${messages.failed}: ${activation.message}`, "error");
	else if (activation.kind === "pending") ctx.ui.notify(messages.pending, "warning");
	else ctx.ui.notify(messages.active, "info");
}
async function openSettingsMenu(ctx, controller) {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`/${COMMAND_NAME} requires interactive TUI mode.`, "warning");
		return;
	}
	await ctx.waitForIdle();
	const scope = await chooseScope(ctx, "Select configuration scope");
	if (scope === void 0) return;
	const projectTrusted = ctx.isProjectTrusted();
	if (scope === "project" && !projectTrusted) {
		ctx.ui.notify("Project config is ignored until Pi trusts this project.", "warning");
		return;
	}
	const selected = readScope(ctx.cwd, scope);
	const other = readActiveScope(ctx.cwd, scope === "global" ? "project" : "global", projectTrusted);
	const cannotEdit = (snapshot) => {
		ctx.ui.notify(`Cannot edit config at '${snapshot.path}': ${snapshot.issue}. Use reset to remove it or fix it manually.`, "error");
	};
	if (!selected.valid) {
		cannotEdit(selected);
		return;
	}
	if (!other.valid) {
		cannotEdit(other);
		return;
	}
	let draft = selected.config;
	for (;;) {
		const layers = scope === "global" ? {
			global: draft,
			project: other.config
		} : {
			global: other.config,
			project: draft
		};
		const effective = mergeConfig(layers.global, layers.project);
		const options = SETTINGS.map((setting) => {
			const state = setting.isSetIn(draft) ? "override" : "inherit";
			return `${setting.label}: ${setting.format(effective)} (source: ${originOf(layers, setting)}; ${scope}: ${state})`;
		});
		const choice = await ctx.ui.select(`Permission auto-review settings (${scope})`, [
			...options,
			SAVE,
			CANCEL
		]);
		if (choice === void 0 || choice === CANCEL) return;
		if (choice === SAVE) {
			const saved = saveScope(selected, draft, projectTrusted);
			if (!saved.ok) {
				ctx.ui.notify(saved.message, "error");
				continue;
			}
			notifyActivation(ctx, controller.applyConfig(saved.loadResult), {
				failed: "Config saved, but the current reviewer could not be replaced",
				pending: "Config saved. It will become active when pi-permission-system is ready.",
				active: "Config saved and applied without reloading the Pi session."
			});
			return;
		}
		const setting = SETTINGS[options.indexOf(choice)];
		if (setting !== void 0) draft = await setting.edit(ctx, draft, effective);
	}
}
function showConfig(ctx, active) {
	const projectTrusted = ctx.isProjectTrusted();
	const global = readScope(ctx.cwd, "global");
	const project = readActiveScope(ctx.cwd, "project", projectTrusted);
	if (active === void 0 || !global.valid || !project.valid) {
		const issues = loadConfig(ctx.cwd, projectTrusted).issues.map((issue) => `\n${issue}`).join("");
		ctx.ui.notify(`Automatic review is disabled because the active config is invalid.${issues}`, "warning");
		return;
	}
	const layers = {
		global: global.config,
		project: project.config
	};
	const lines = SETTINGS.map((setting) => `${setting.key}=${setting.format(active)} (${originOf(layers, setting)})`);
	const ignored = projectTrusted ? "" : " (ignored until Pi trusts this project)";
	ctx.ui.notify(`permission-auto-review:\n${lines.join("\n")}\nglobal=${global.path}\nproject=${project.path}${ignored}`, "info");
}
function showDefaults(ctx, active) {
	const { preset } = active ?? DEFAULT_CONFIG;
	const { builtInRules } = PRESETS[preset];
	const lines = RULE_LISTS.map((list) => `${list}: ${builtInRules[list].map(ruleLabel).join(", ") || "none"}`);
	ctx.ui.notify(`Built-in rules of the ${preset} preset, which ${DEFAULTS_ENTRY} stands for:\n${lines.join("\n")}`, "info");
}
async function resetConfig(ctx, controller, requested) {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`/${COMMAND_NAME} reset requires interactive TUI mode.`, "warning");
		return;
	}
	await ctx.waitForIdle();
	if (requested !== void 0 && requested !== "global" && requested !== "project") {
		ctx.ui.notify(USAGE, "warning");
		return;
	}
	const scope = requested ?? await chooseScope(ctx, "Select configuration scope to reset");
	if (scope === void 0) return;
	const snapshot = readScope(ctx.cwd, scope);
	if (!await ctx.ui.confirm(`Reset ${scope} auto-review config?`, `Delete '${snapshot.path}' and immediately apply inherited values?`)) return;
	const reset = resetScope(snapshot, ctx.isProjectTrusted());
	if (!reset.ok) {
		ctx.ui.notify(reset.message, "error");
		return;
	}
	notifyActivation(ctx, controller.applyConfig(reset.loadResult), {
		failed: "Config reset, but the current reviewer could not be replaced",
		pending: `${scope} config reset. The inherited config will activate when pi-permission-system is ready.`,
		active: `${scope} config reset and inherited values applied without reloading the Pi session.`
	});
}
const SUBCOMMANDS = [
	{
		value: "show",
		label: "Show active config",
		description: "Display effective values and their origins"
	},
	{
		value: "path",
		label: "Show config paths",
		description: "Display global and project config paths"
	},
	{
		value: "defaults",
		label: "Show built-in rules",
		description: `List the rules ${DEFAULTS_ENTRY} stands for`
	},
	{
		value: "reset",
		label: "Reset config",
		description: "Delete one config layer and apply inherited values"
	},
	{
		value: "help",
		label: "Show help",
		description: "Display command usage"
	}
];
const RESET_SCOPES = [{
	value: "reset global",
	label: "Reset global config",
	description: "Delete the global auto-review config"
}, {
	value: "reset project",
	label: "Reset project config",
	description: "Delete the project auto-review config"
}];
function registerAutoReviewCommand(pi, controller) {
	pi.registerCommand(COMMAND_NAME, {
		description: "Configure pi-permission-auto-review without reloading the Pi session",
		getArgumentCompletions(prefix) {
			const normalized = prefix.trimStart().toLowerCase();
			const matches = (normalized.startsWith("reset ") ? RESET_SCOPES : SUBCOMMANDS).filter((item) => item.value.startsWith(normalized));
			return matches.length > 0 ? matches : null;
		},
		async handler(args, ctx) {
			const normalized = args.trim().toLowerCase();
			if (normalized === "") await openSettingsMenu(ctx, controller);
			else if (normalized === "show") showConfig(ctx, controller.getActiveConfig());
			else if (normalized === "path") ctx.ui.notify(`permission-auto-review config paths:\nglobal=${configPath(ctx.cwd, "global")}\nproject=${configPath(ctx.cwd, "project")}`, "info");
			else if (normalized === "defaults") showDefaults(ctx, controller.getActiveConfig());
			else if (normalized === "help") ctx.ui.notify(USAGE, "info");
			else if (normalized === "reset" || normalized.startsWith("reset ")) await resetConfig(ctx, controller, normalized.split(WHITESPACE)[1]);
			else ctx.ui.notify(USAGE, "warning");
		}
	});
}

// src/reviewer/model.ts
const FAMILY_FAST_CANDIDATES = {
	meta: ["muse-spark-1.4-internal", "muse-spark-1.3-internal", "muse-latest"],
	anthropic: ["claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-5-5", "claude-sonnet-5"],
	google: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
	openai: ["gpt-6-luna", "gpt-5.6-luna", "gpt-5.4-mini"]
};
const CODEX_API = "openai-codex-responses";
/** Resolve the reviewer model, preferring the fast model of the active session's model family when using defaults */
function resolveReviewModel(registry, config, fallbackModel) {
	const isDefaultAnthropic = config.provider === "anthropic" && config.model === "claude-sonnet-5";
	const isTierAlias = config.model === "fast" || config.model === "balanced" || config.model === "inherit";
	if (!isDefaultAnthropic && !isTierAlias) {
		const registered = registry.find(config.provider, config.model);
		if (registered !== void 0 && (typeof registry.hasConfiguredAuth !== "function" || registry.hasConfiguredAuth(registered))) {
			return { ok: true, value: registered };
		}
	}
	const preferredProvider = fallbackModel?.provider ?? config.provider;
	const providerOrder = [
		...(preferredProvider in FAMILY_FAST_CANDIDATES ? [preferredProvider] : []),
		...Object.keys(FAMILY_FAST_CANDIDATES).filter((p) => p !== preferredProvider)
	];
	for (const prov of providerOrder) {
		for (const id of FAMILY_FAST_CANDIDATES[prov] ?? []) {
			const found = registry.find(prov, id);
			if (found !== void 0 && (typeof registry.hasConfiguredAuth !== "function" || registry.hasConfiguredAuth(found))) {
				return { ok: true, value: found };
			}
		}
	}
	if (fallbackModel !== void 0) {
		return { ok: true, value: fallbackModel };
	}
	const provider = registry.getProvider(config.provider);
	if (provider === void 0) return {
		ok: false,
		category: "provider-unresolved"
	};
	const registered = registry.find(config.provider, config.model);
	if (registered !== void 0) return {
		ok: true,
		value: registered
	};
	if (config.provider !== "openai-codex" || config.model !== "codex-auto-review") return {
		ok: false,
		category: "model-unresolved"
	};
	const template = registry.getAll().find((model) => model.provider === "openai-codex" && model.api === CODEX_API) ?? provider.getModels().find((model) => model.api === CODEX_API);
	return template === void 0 ? {
		ok: false,
		category: "model-unresolved"
	} : {
		ok: true,
		value: {
			...template,
			id: CODEX_AUTO_REVIEW_MODEL,
			name: "Codex Auto Review",
			reasoning: true,
			input: ["text"]
		}
	};
}

// src/reviewer/reviewer.ts
const DECISION_EVENT = "auto_review.decision";
async function runReview(runtime, preset, details, conversation) {
	const { config, context } = runtime;
	const deadline = Date.now() + config.timeoutMs;
	const timeoutController = new AbortController();
	const timeout = setTimeout(() => timeoutController.abort(), config.timeoutMs);
	const turnSignal = context.signal;
	const signal = AbortSignal.any([
		timeoutController.signal,
		runtime.sessionSignal,
		...turnSignal === void 0 ? [] : [turnSignal]
	]);
	try {
		if (signal.aborted) return {
			kind: "failed",
			failure: "cancelled"
		};
		const resolved = resolveReviewModel(context.modelRegistry, config, context.model);
		if (!resolved.ok) return {
			kind: "failed",
			failure: resolved.category
		};
		const model = resolved.value;
		const usage = {
			input: 0,
			cacheRead: 0,
			output: 0
		};
		const complete = createModelCall({
			registry: context.modelRegistry,
			model,
			config,
			sessionId: context.sessionManager.getSessionId(),
			signal,
			timeoutSignal: timeoutController.signal,
			deadline,
			usage
		});
		return {
			...await preset.review({
				config,
				branch: context.sessionManager.getBranch(),
				details,
				contextFiles: runtime.contextFiles(),
				conversation,
				contextWindow: model.contextWindow
			}, complete),
			usage
		};
	} finally {
		clearTimeout(timeout);
	}
}
function createPermissionReviewer(runtime) {
	const { config } = runtime;
	const preset = PRESETS[config.preset];
	const limiter = preset.createLimiter();
	let conversation;
	const authorize = async (details, _query, log) => {
		const startedAt = Date.now();
		const entryBase = {
			requestId: details.requestId,
			provider: config.provider,
			model: config.model
		};
		const elapsed = () => Math.max(0, Date.now() - startedAt);
		const logFailure = (entry) => {
			log.review(DECISION_EVENT, entry);
			log.debug("auto_review.failure", entry);
		};
		try {
			const refusal = limiter.refusal();
			if (refusal !== void 0) {
				log.review("auto_review.circuit_open", {
					...entryBase,
					outcome: "deny",
					durationMs: 0,
					errorCategory: "circuit-open"
				});
				return {
					kind: "deny",
					reason: refusal
				};
			}
			const result = await runReview(runtime, preset, details, conversation);
			const durationMs = elapsed();
			const diagnostics = {
				policyRevision: preset.policyRevision,
				contextSource: "active-branch",
				...result.fields,
				...result.usage === void 0 ? {} : { usage: result.usage }
			};
			if (result.kind === "failed") {
				if (result.failure !== "cancelled") conversation = void 0;
				const verdict = result.failure === "cancelled" ? {
					kind: "deny",
					reason: "The automatic review was cancelled before it finished"
				} : { kind: "defer" };
				limiter.recordNonDenial();
				logFailure({
					...entryBase,
					outcome: verdict.kind,
					errorCategory: result.failure,
					durationMs,
					...diagnostics
				});
				return verdict;
			}
			conversation = result.conversation;
			if (result.kind === "allow") {
				limiter.recordNonDenial();
				log.review(DECISION_EVENT, {
					...entryBase,
					outcome: "allow",
					durationMs,
					...diagnostics
				});
				return { kind: "allow" };
			}
			const denialLimit = limiter.recordDenial();
			if (denialLimit !== void 0) {
				log.review(DECISION_EVENT, {
					...entryBase,
					outcome: "defer",
					denialLimit,
					durationMs,
					...diagnostics
				});
				return { kind: "defer" };
			}
			log.review(DECISION_EVENT, {
				...entryBase,
				outcome: "deny",
				durationMs,
				...diagnostics
			});
			return {
				kind: "deny",
				reason: result.reason
			};
		} catch {
			conversation = void 0;
			limiter.recordNonDenial();
			logFailure({
				...entryBase,
				outcome: "defer",
				errorCategory: "internal-error",
				durationMs: elapsed()
			});
			return { kind: "defer" };
		}
	};
	return {
		authorize,
		resetTurn: () => limiter.resetTurn()
	};
}

// src/index.ts
const AUTHORIZER_NAME = "auto-review";
const VERDICT_LABELS = [
	["allow", "allowed"],
	["deny", "denied"],
	["defer", "deferred"]
];
const deferInvalidConfig = async (details, _query, log) => {
	log.review("auto_review.decision", {
		requestId: details.requestId,
		outcome: "defer",
		errorCategory: "config-invalid"
	});
	return { kind: "defer" };
};
function warn(message) {
	console.warn(`[${EXTENSION_ID}] ${message}`);
}
function describeError(error) {
	return error instanceof Error ? error.message : String(error);
}
function statusText(current, tally) {
	if (current.config === void 0) return `${AUTHORIZER_NAME} inactive: invalid config`;
	if (current.dispose === void 0) return void 0;
	const counts = VERDICT_LABELS.flatMap(([kind, label]) => tally[kind] > 0 ? [`${tally[kind]} ${label}`] : []);
	if (counts.length === 0) return void 0;
	return [`${AUTHORIZER_NAME}`, ...counts].join(" · ");
}
function permissionAutoReview(pi) {
	let generation;
	let tally = {
		allow: 0,
		deny: 0,
		defer: 0
	};
	let contextFiles = [];
	let sessionId;
	let warnedMissingSessionId = false;
	function renderStatus(current) {
		current.runtime.ui.setStatus(EXTENSION_ID, statusText(current, tally));
	}
	function createGeneration(runtime, config) {
		const controller = new AbortController();
		const reviewer = config === void 0 ? {
			authorize: deferInvalidConfig,
			resetTurn: () => {}
		} : createPermissionReviewer({
			config,
			context: runtime,
			contextFiles: () => contextFiles,
			sessionSignal: controller.signal
		});
		const created = {
			runtime,
			config,
			controller,
			resetTurn: reviewer.resetTurn,
			authorize: async (details, query, log) => {
				const verdict = await reviewer.authorize(details, query, log);
				if (generation === created) {
					tally[verdict.kind] += 1;
					renderStatus(created);
				}
				return verdict;
			},
			dispose: void 0
		};
		return created;
	}
	/** Throws when the service refuses the link, leaving `target` unregistered */
	function register(target, service) {
		target.dispose = service.registerAuthorizer(AUTHORIZER_NAME, target.authorize);
		renderStatus(target);
	}
	function retire(retired) {
		retired?.dispose?.();
		retired?.controller.abort();
	}
	function reportIssues(issues) {
		for (const issue of issues) warn(`config issue at ${issue}`);
	}
	function applyConfig(result) {
		reportIssues(result.issues);
		const current = generation;
		if (result.config === void 0) return {
			kind: "failed",
			message: "the merged config is invalid; the previous reviewer remains active"
		};
		const service = sessionId === void 0 ? void 0 : getPermissionsService(sessionId);
		if (service === void 0 && current.dispose !== void 0) return {
			kind: "failed",
			message: "pi-permission-system became unavailable while the old reviewer was still registered"
		};
		const candidate = createGeneration(current.runtime, result.config);
		retire(current);
		generation = candidate;
		renderStatus(candidate);
		if (service === void 0) return { kind: "pending" };
		try {
			register(candidate, service);
		} catch (error) {
			return {
				kind: "failed",
				message: `the new reviewer could not be registered: ${describeError(error)}`
			};
		}
		return { kind: "active" };
	}
	pi.on("session_start", (_event, ctx) => {
		retire(generation);
		const projectTrusted = ctx.isProjectTrusted();
		const result = loadConfig(ctx.cwd, projectTrusted);
		reportIssues(result.issues);
		const projectPath = configPath(ctx.cwd, "project");
		if (!projectTrusted && existsSync(projectPath)) warn(`${projectPath} is ignored until Pi trusts this project`);
		tally = {
			allow: 0,
			deny: 0,
			defer: 0
		};
		contextFiles = [];
		generation = createGeneration(ctx, result.config);
		renderStatus(generation);
	});
	pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
		const ready = data;
		if (ready.sessionId === null) {
			if (!warnedMissingSessionId) {
				warnedMissingSessionId = true;
				warn(`pi-permission-system published no keyed service for this node; ${AUTHORIZER_NAME} stays unregistered`);
			}
			return;
		}
		sessionId ??= ready.sessionId;
		const service = getPermissionsService(sessionId);
		if (generation === void 0 || generation.dispose !== void 0 || service === void 0) return;
		try {
			register(generation, service);
		} catch (error) {
			warn(`failed to register ${AUTHORIZER_NAME}: ${describeError(error)}`);
		}
	});
	pi.on("before_agent_start", (event, ctx) => {
		const agentDir = resolve(getAgentDir());
		const projectTrusted = ctx.isProjectTrusted();
		contextFiles = (event.systemPromptOptions.contextFiles ?? []).filter((file) => projectTrusted || dirname(resolve(file.path)) === agentDir);
	});
	pi.on("turn_start", () => {
		generation?.resetTurn();
	});
	pi.on("session_shutdown", (_event, ctx) => {
		ctx.ui.setStatus(EXTENSION_ID, void 0);
		retire(generation);
		generation = void 0;
		sessionId = void 0;
		warnedMissingSessionId = false;
	});
	registerAutoReviewCommand(pi, {
		getActiveConfig: () => generation?.config,
		applyConfig
	});
}

export { permissionAutoReview as default };
//# sourceMappingURL=index.js.map