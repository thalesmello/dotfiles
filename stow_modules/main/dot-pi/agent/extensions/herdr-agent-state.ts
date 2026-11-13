// installed by herdr
// managed by herdr; reinstalling or updating the integration overwrites this file.
// add custom hooks/plugins beside this file instead of editing it.
// HERDR_INTEGRATION_ID=pi
// HERDR_INTEGRATION_VERSION=9
// @ts-nocheck

import net from "node:net";
import path from "node:path";

const HERDR_ENV = process.env.HERDR_ENV;
const HC_TERMINAL_ID = process.env.HC_TERMINAL_ID;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;
const source = "herdr:pi";
const HERDR_TERMINAL_INSTRUCTIONS = [
  "Herdr is the terminal multiplexer in this environment.",
  "",
  "**Do not use `tmux`.** Do not create or attach to tmux sessions, windows, or panes; do not drive terminals or agents with `tmux new-session`, `send-keys`, `capture-pane`, or similar commands; and do not use tmux as a disposable/background terminal or as a harness for testing another TUI or agent. Use Herdr workspaces, tabs, panes, `pane run`, `pane wait-output`, `pane read`, `agent start`, and `agent prompt` instead. If Herdr is unavailable, stop and say so rather than falling back to tmux. The only exception is when Thales explicitly asks you to use tmux in the current request.",
].join("\n");

const HC_TERMINAL_INSTRUCTIONS = [
  "Herdr (`herdr-app` + `hc`) is the terminal runtime and window manager in this environment.",
  "",
  "**Do not use `tmux`.** Do not create or attach to tmux sessions, windows, or panes; do not drive terminals or agents with `tmux new-session`, `send-keys`, `capture-pane`, or similar commands; and do not use tmux as a disposable/background terminal or as a harness for testing another TUI or agent. Use `hc` (`hc run`, `hc wait`, `hc read`, `hc send`, `hc keys`) and `herdr-app` (`herdr-app do ...`) instead. If `hc` is unavailable, stop and say so rather than falling back to tmux. The only exception is when Thales explicitly asks you to use tmux in the current request.",
].join("\n");

function enabled() {
  return HERDR_ENV === "1" && !!socketPath && !!paneId;
}

function isHcSession() {
  return Boolean(HC_TERMINAL_ID) && (!enabled() || process.env.TERM_PROGRAM === "ghostty");
}

function inAnyHerdrOrHc() {
  return enabled() || isHcSession();
}

function sendRequestAttempt(request: unknown, timeoutMs: number): Promise<boolean> {
  if (!enabled()) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let done = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (delivered: boolean) => {
      if (done) return;
      done = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      socket.destroy();
      resolve(delivered);
    };

    const socket = net.createConnection(socketEndpoint!);
    socket.on("error", () => finish(false));
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", () => finish(true));
    socket.on("end", () => finish(false));
    timeout = setTimeout(() => finish(false), timeoutMs);
    timeout.unref?.();
  });
}

async function sendRequest(request: unknown): Promise<void> {
  if (await sendRequestAttempt(request, 500)) {
    return;
  }
  await sendRequestAttempt(request, 1500);
}

export type AgentState = "working" | "blocked" | "idle";

export const STATUS_KEY = "herdr-agent-state";
export const DEFAULT_WAITING_MESSAGE = "Waiting for user input";
const MAX_OSC_MESSAGE_BYTES = 2048;

export function firstLine(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  const line = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .split(/\r?\n/, 1)[0]
    ?.trim();
  return line ? line : undefined;
}

export function formatWaitingMessage(detail?: unknown): string {
  const line = firstLine(detail);
  if (!line) return DEFAULT_WAITING_MESSAGE;
  if (/^(waiting for user input|awaiting input|permission required)\b/i.test(line)) {
    return line;
  }
  return `${DEFAULT_WAITING_MESSAGE}: ${line}`;
}

export function extractToolErrorText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { content?: unknown; errorMessage?: unknown };
  const direct = firstLine(r.errorMessage);
  if (direct) return direct;
  if (Array.isArray(r.content)) {
    for (const part of r.content) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        const line = firstLine((part as { text?: unknown }).text);
        if (line) return line;
      }
    }
  }
  return undefined;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

export function formatOsc7501Status(state: AgentState, message?: string): string {
  const pairs = [`state=${state}`, "app=pi"];
  const clean = truncateUtf8(firstLine(message) ?? "", MAX_OSC_MESSAGE_BYTES);
  if (clean) {
    pairs.push(`msg=${Buffer.from(clean, "utf8").toString("base64")}`);
  }
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}

function findLastReloadBranchError(ctx: any): string | undefined {
  try {
    const branch = ctx?.sessionManager?.getBranch?.();
    if (!Array.isArray(branch)) return undefined;
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (!entry || entry.type !== "message" || !entry.message) continue;
      const msg = entry.message;
      if (msg.role === "user") return undefined;
      if (msg.role === "assistant") {
        if (msg.stopReason === "error") {
          return formatWaitingMessage(msg.errorMessage || "API error");
        }
        if (msg.stopReason === "length") {
          return formatWaitingMessage("Response truncated at token limit");
        }
        return undefined;
      }
    }
  } catch {
    // Ignore session inspection errors
  }
  return undefined;
}

type QueuedState = {
  state: AgentState;
  message?: string;
  seq: number;
};

let reportSeq = Date.now() * 1000;
let currentAgentSessionId: string | undefined;
let currentAgentSessionPath: string | undefined;

function nextReportSeq(): number {
  reportSeq += 1;
  return reportSeq;
}

function updateSessionRef(ctx: any): void {
  try {
    const file = ctx?.sessionManager?.getSessionFile?.();
    currentAgentSessionPath =
      typeof file === "string" &&
      (path.posix.isAbsolute(file) || path.win32.isAbsolute(file))
        ? file
        : undefined;
  } catch {
    currentAgentSessionPath = undefined;
  }

  try {
    const id = ctx?.sessionManager?.getSessionId?.();
    currentAgentSessionId = typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    currentAgentSessionId = undefined;
  }
}

function withSessionRef(params: Record<string, unknown>): Record<string, unknown> {
  if (currentAgentSessionPath) {
    return { ...params, agent_session_path: currentAgentSessionPath };
  }
  if (currentAgentSessionId) {
    return { ...params, agent_session_id: currentAgentSessionId };
  }
  return params;
}

function currentSessionRef(): Record<string, unknown> | undefined {
  if (currentAgentSessionPath) {
    return { agent_session_path: currentAgentSessionPath };
  }
  if (currentAgentSessionId) {
    return { agent_session_id: currentAgentSessionId };
  }
  return undefined;
}

function reportSession(sessionStartSource?: string): Promise<void> {
  const sessionRef = currentSessionRef();
  if (!sessionRef) {
    return Promise.resolve();
  }

  return sendRequest({
    id: `${source}:session:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent_session",
    params: {
      pane_id: paneId,
      source,
      agent: "pi",
      seq: nextReportSeq(),
      session_start_source: sessionStartSource,
      ...sessionRef,
    },
  });
}

function sendState(state: AgentState, message?: string, seq = nextReportSeq()): Promise<void> {
  return sendRequest({
    id: `${source}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent",
    params: withSessionRef({
      pane_id: paneId,
      source,
      agent: "pi",
      state,
      message,
      seq,
    }),
  });
}

let sendInFlight = false;
let queuedState: QueuedState | undefined;

function queueState(state: AgentState, message?: string): void {
  queuedState = { state, message, seq: nextReportSeq() };
  if (!sendInFlight) {
    void drainStateQueue();
  }
}

async function drainStateQueue(): Promise<void> {
  if (sendInFlight) {
    return;
  }

  sendInFlight = true;
  try {
    while (queuedState) {
      const next = queuedState;
      queuedState = undefined;
      await sendState(next.state, next.message, next.seq);
    }
  } finally {
    sendInFlight = false;
    if (queuedState) {
      void drainStateQueue();
    }
  }
}

type HerdrAgentStateDeps = {
  enabled?: boolean;
  herdrSocketEnabled?: boolean;
  hcSession?: boolean;
  sendState?: (state: AgentState, message?: string, seq?: number) => Promise<void> | void;
  reportSession?: (sessionStartSource?: string) => Promise<void> | void;
  writeOscStatus?: (sequence: string) => void;
};

export default function (pi, deps: HerdrAgentStateDeps = {}) {
  const socketActive = deps.herdrSocketEnabled ?? enabled();
  const hcActive = deps.hcSession ?? isHcSession();
  const isEnabled = deps.enabled ?? (socketActive || hcActive);
  if (!isEnabled) {
    return;
  }

  let agentActive = false;
  const manualBlockedLabels: string[] = [];
  let uiPromptBlockedMessage: string | undefined;
  let apiErrorReason: string | undefined;
  let toolBlockReason: string | undefined;
  let settledBlockReason: string | undefined;
  let lastState: AgentState | undefined;
  let lastMessage: string | undefined;
  let lastCtx: any;
  let rootSession = false;

  const reportSessionFn = deps.reportSession ?? reportSession;

  function dispatchState(state: AgentState, message?: string): void {
    if (deps.sendState) {
      void deps.sendState(state, message, nextReportSeq());
      return;
    }
    if (socketActive) {
      queueState(state, message);
    }
  }

  function emitOscStatus(state: AgentState, message?: string): void {
    const writeFn =
      deps.writeOscStatus ??
      (hcActive || process.env.PI_PROGRAM_STATUS === "1"
        ? (seq: string) => {
            try {
              process.stdout.write(seq);
            } catch {
              // Ignore stdout write errors
            }
          }
        : undefined);
    if (!writeFn) return;
    const sequence = formatOsc7501Status(state, message);
    if (deps.writeOscStatus) {
      writeFn(sequence);
    } else {
      setImmediate(() => writeFn(sequence));
    }
  }

  function updateFooterStatus(state: AgentState, message?: string): void {
    const ui = lastCtx?.ui;
    if (!ui || typeof ui.setStatus !== "function") return;
    if (state === "blocked") {
      const label = message || DEFAULT_WAITING_MESSAGE;
      const text = `blocked · ${label}`;
      const styled = typeof ui.theme?.fg === "function" ? ui.theme.fg("error", text) : text;
      ui.setStatus(STATUS_KEY, styled);
    } else {
      ui.setStatus(STATUS_KEY, undefined);
    }
  }

  function desiredState(): { state: AgentState; message: string | undefined } {
    if (manualBlockedLabels.length > 0) {
      return {
        state: "blocked" as const,
        message: manualBlockedLabels[manualBlockedLabels.length - 1],
      };
    }
    if (uiPromptBlockedMessage !== undefined) {
      return {
        state: "blocked" as const,
        message: uiPromptBlockedMessage,
      };
    }
    if (agentActive) {
      return { state: "working" as const, message: undefined };
    }
    if (settledBlockReason !== undefined) {
      return {
        state: "blocked" as const,
        message: settledBlockReason,
      };
    }
    return { state: "idle" as const, message: undefined };
  }

  function publishState(force = false) {
    const next = desiredState();
    const prevState = lastState;
    updateFooterStatus(next.state, next.message);
    if (!force && next.state === lastState && next.message === lastMessage) {
      return;
    }
    lastState = next.state;
    lastMessage = next.message;
    dispatchState(next.state, next.message);
    if (next.state === "blocked" || prevState === "blocked") {
      emitOscStatus(next.state, next.message);
    }
  }

  pi.on("before_agent_start", (event, ctx) => {
    if (ctx) lastCtx = ctx;
    if (!rootSession) {
      if (event?.systemPromptOptions?.sections) {
        delete event.systemPromptOptions.sections.herdr_terminal;
      }
      return;
    }
    if (event?.systemPromptOptions?.sections) {
      event.systemPromptOptions.sections.herdr_terminal = hcActive
        ? HC_TERMINAL_INSTRUCTIONS
        : HERDR_TERMINAL_INSTRUCTIONS;
    }
    apiErrorReason = undefined;
    toolBlockReason = undefined;
    if (settledBlockReason !== undefined) {
      settledBlockReason = undefined;
      publishState();
    }
  });

  pi.events.on("herdr:blocked", (data) => {
    if (!rootSession) {
      return;
    }
    if (!data?.active) {
      if (manualBlockedLabels.length > 0) {
        manualBlockedLabels.pop();
      }
      publishState();
      return;
    }

    manualBlockedLabels.push(formatWaitingMessage(data.label));
    publishState();
  });

  pi.events.on("permissions:decision", (data) => {
    if (!rootSession || data?.result !== "deny") {
      return;
    }
    if (data?.forwarding) {
      return;
    }
    const surface = typeof data.surface === "string" && data.surface ? data.surface : "permission";
    const value = firstLine(data.value);
    const reason = formatWaitingMessage(
      value ? `Permission denied (${surface}): ${value}` : `Permission denied (${surface})`,
    );
    if (agentActive) {
      toolBlockReason = reason;
    } else {
      settledBlockReason = reason;
      publishState();
    }
  });

  pi.on("ui_prompt_start", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    // Block on any explicit prompt (select/confirm/input/editor), and on custom UI
    // dialogs opened while an agent run is active.
    if (event?.kind === "custom" && !agentActive) {
      return;
    }
    uiPromptBlockedMessage = formatWaitingMessage(event?.title);
    publishState();
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (uiPromptBlockedMessage !== undefined) {
      uiPromptBlockedMessage = undefined;
      publishState();
    }
  });

  pi.on("input", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (event?.source !== "extension" && settledBlockReason !== undefined) {
      settledBlockReason = undefined;
      publishState();
    }
  });

  pi.on("session_start", async (event, ctx) => {
    // TUI only: RPC/JSON/print modes are headless (no PTY herdr can display),
    // and RPC still reports hasUI=true, so mode is the reliable gate.
    if (ctx?.mode !== "tui") {
      return;
    }
    rootSession = true;
    lastCtx = ctx;
    updateSessionRef(ctx);
    await reportSessionFn(event?.reason);
    manualBlockedLabels.length = 0;
    uiPromptBlockedMessage = undefined;
    apiErrorReason = undefined;
    toolBlockReason = undefined;
    // A reload can replace this extension mid-run without emitting another agent_start.
    agentActive = ctx?.isIdle?.() === false;
    settledBlockReason =
      !agentActive && event?.reason === "reload" ? findLastReloadBranchError(ctx) : undefined;
    publishState(true);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    apiErrorReason = undefined;
    toolBlockReason = undefined;
    settledBlockReason = undefined;
    publishState();
  });

  pi.on("agent_start", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    updateSessionRef(ctx);
    void reportSessionFn();
    agentActive = true;
    apiErrorReason = undefined;
    toolBlockReason = undefined;
    settledBlockReason = undefined;
    publishState();
  });

  pi.on("turn_start", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    apiErrorReason = undefined;
  });

  pi.on("message_start", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    const role = event?.message?.role;
    if (role === "user" || role === "assistant") {
      apiErrorReason = undefined;
      if (role === "user") {
        settledBlockReason = undefined;
      }
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    const msg = event?.message;
    if (msg?.role !== "assistant") {
      return;
    }
    if (msg.stopReason === "error") {
      apiErrorReason = formatWaitingMessage(msg.errorMessage || "API error");
    } else if (msg.stopReason === "length") {
      apiErrorReason = formatWaitingMessage("Response truncated at token limit");
    } else {
      apiErrorReason = undefined;
    }
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (!rootSession || event?.parentToolCallId) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (event?.isError && event?.durationMs === undefined) {
      const text = extractToolErrorText(event?.result);
      if (text !== "Operation aborted") {
        toolBlockReason = formatWaitingMessage(
          text || `Tool ${event?.toolName || "call"} blocked`,
        );
      }
    } else if (!event?.isError) {
      toolBlockReason = undefined;
    }
  });

  pi.on("turn_end", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (event?.outcome === "error" || event?.message?.stopReason === "error") {
      apiErrorReason = formatWaitingMessage(event?.message?.errorMessage || "API error");
    } else if (event?.outcome === "aborted" || event?.message?.stopReason === "aborted") {
      apiErrorReason = undefined;
    }
  });

  pi.on("agent_end", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    const messages = event?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return;
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant") {
      if (lastMsg.stopReason === "error") {
        apiErrorReason = formatWaitingMessage(lastMsg.errorMessage || "API error");
      } else if (lastMsg.stopReason === "length") {
        apiErrorReason = formatWaitingMessage("Response truncated at token limit");
      } else if (lastMsg.stopReason === "aborted") {
        apiErrorReason = undefined;
      } else {
        apiErrorReason = undefined;
      }
    } else if (lastMsg?.role === "toolResult" && lastMsg.isError) {
      // A terminating blocked tool call ended the run before a follow-up assistant turn.
      const text = extractToolErrorText(lastMsg);
      if (text !== "Operation aborted" && !toolBlockReason) {
        toolBlockReason = formatWaitingMessage(text || "Tool execution blocked");
      }
    }
  });

  pi.on("session_compact_failed", (event, ctx) => {
    if (!rootSession || event?.aborted) {
      return;
    }
    if (ctx) lastCtx = ctx;
    const reason = formatWaitingMessage(event?.errorMessage || "Compaction failed");
    if (agentActive) {
      apiErrorReason = reason;
    } else {
      settledBlockReason = reason;
      publishState();
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (!agentActive && settledBlockReason !== undefined) {
      settledBlockReason = undefined;
      publishState();
    }
  });

  pi.on("agent_before_settle", (event, ctx) => {
    if (!rootSession) {
      return;
    }
    if (ctx) lastCtx = ctx;
    if (event?.outcome === "error" && !apiErrorReason) {
      apiErrorReason = formatWaitingMessage("API error");
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    if (!rootSession || ctx?.isIdle?.() !== true) {
      return;
    }
    if (ctx) lastCtx = ctx;

    agentActive = false;
    uiPromptBlockedMessage = undefined;
    if (event?.aborted) {
      apiErrorReason = undefined;
      toolBlockReason = undefined;
      settledBlockReason = undefined;
    } else {
      const blockReason = apiErrorReason ?? toolBlockReason;
      if (blockReason) {
        settledBlockReason = blockReason;
      }
      apiErrorReason = undefined;
      toolBlockReason = undefined;
    }
    publishState();
  });
}
