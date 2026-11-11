import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Input,
  type KeyId,
  matchesKey,
} from "@earendil-works/pi-tui";
import type { PromptNotificationChannel } from "../config/config-schema.ts";
import type { DialogKeyBindings, PromptAction } from "../config/dialog-keys.ts";
import {
  completeViewBudget,
  type DialogView,
  type RenderBudget,
  renderPromptDialog,
} from "../presentation/dialog-renderer.ts";
import { fitLinesToWidth } from "../presentation/line-fitting.ts";
import {
  type PromptNotice,
  renderPromptNotification,
} from "../presentation/prompt-notification.ts";
import type { PromptPayload } from "../presentation/prompt-payload.ts";
import { AnswerWindow } from "./answer-window.ts";
import { collapsePastedNewlines } from "./bracketed-paste.ts";
import type { DecisionSource, UserDecisionSurface } from "./decision-source.ts";
import {
  type PermissionPromptDecision,
  type RequestPermissionOptions,
  type RuleProposal,
  type RuleProposer,
  requestPermissionDecisionFromUi,
  type UnattributedDecision,
} from "./permission-dialog.ts";
import {
  initialPromptState,
  type PromptEvent,
  type PromptModelConfig,
  type PromptViewState,
  type ProposalChoice,
  reducePrompt,
  visibleActions,
} from "./permission-prompt-decision.ts";

/**
 * Inline `ctx.ui.custom` permission dialog for TUI sessions.
 *
 * All interaction logic lives in the pure {@link reducePrompt} model; this
 * module is the thin adapter that renders the model's state to lines, maps raw
 * keystrokes to {@link PromptEvent}s, and resolves the `ctx.ui.custom` promise
 * with the committed {@link PermissionPromptDecision}. The component renders
 * inline (never as an overlay).
 */

/** The subset of the session UI surface the inline dialog needs. */
export type PermissionPromptUi = Pick<
  ExtensionUIContext,
  "select" | "input" | "custom" | "getToolsExpanded" | "setToolsExpanded"
>;

/** The keybindings surface the dialog consults; only `matches` is read (ISP). */
type PromptKeybindings = Pick<KeybindingsManager, "matches">;

/** The resolved presentation context selected once per activation. */
export interface PermissionPromptView extends PromptPreferences {
  mode: ExtensionContext["mode"];
  ui: PermissionPromptUi;
  /** What the inline dialog's terminal notification says; the fallback ignores it. */
  notice: PromptNotice;
}

/** Live prompt-behavior preferences read at prompt time (see `doublePressToConfirm`). */
export interface PromptPreferences {
  doublePressToConfirm: boolean;
  /** How much room a render has; the terminal width is added per frame. */
  budget: RenderBudget;
  /** The character bound to each decision. */
  dialogKeys: DialogKeyBindings;
  /** Terminal notifications the inline dialog emits as it opens; empty for none. */
  promptNotifications: readonly PromptNotificationChannel[];
  /** How long a shown prompt waits for an answer before it denies; absent for no timer. */
  promptTimeoutMs?: number;
  /** Optional AI rule proposer that interprets natural-language allow explanations. */
  proposeRules?: (
    instruction: string,
    payload: PromptPayload,
    signal?: AbortSignal,
  ) => Promise<RuleProposal>;
}

/**
 * Route a permission ask to the inline keybind dialog in TUI mode, or the
 * `select()`/`input()` flow otherwise (RPC / frontend — the #519 constraint).
 *
 * The single entry the `LocalUserAuthorizer` calls; keeps the mode dispatch in
 * one place so the fallback and the inline component never both render.
 *
 * It is therefore also the one place that knows which surface the human
 * answered on, so it is where the decision is attributed to that surface
 * (#726). Having the dialog model and the fallback each name themselves would
 * be two sites that must agree with this branch.
 *
 * It also opens the prompt's {@link AnswerWindow} as the prompt is shown. A
 * surface the window dismissed answers `undefined`, and the window, which is
 * what decided, stamps the `unanswered` decision itself.
 */
export async function requestPermissionDecision(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const window = AnswerWindow.open(view.promptTimeoutMs);
  const surface = chooseDecisionSurface(view, title, payload, options);
  try {
    const answer = await surface.ask(window);
    return answer === undefined
      ? window.expiredDecision()
      : attributeToHuman(answer, surface.via);
  } finally {
    window.close();
  }
}

type PromptSurfaceAnswer = UnattributedDecision | PermissionPromptDecision;

/**
 * One human-facing surface: how to ask on it, and the name it answers under.
 *
 * `ask` answers `undefined` only when the window dismissed the prompt.
 */
interface DecisionSurface {
  via: UserDecisionSurface;
  ask: (window: DialogClock) => Promise<PromptSurfaceAnswer | undefined>;
}

/**
 * The answer window as a surface uses it: the signal that dismisses the
 * prompt, and — for the inline dialog, which sees keystrokes — the
 * running length to show and the means to stop it once the human engages.
 */
export type DialogClock = Pick<
  AnswerWindow,
  "signal" | "pendingTimeoutMs" | "engage"
>;

function chooseDecisionSurface(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): DecisionSurface {
  if (view.mode === "tui") {
    return {
      via: "dialog",
      ask: (window) =>
        presentInlinePermissionPrompt(view, title, payload, options, window),
    };
  }
  return {
    via: "select",
    ask: (window) =>
      askThroughFallback(view, title, payload, options, window.signal),
  };
}

async function askThroughFallback(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options: RequestPermissionOptions | undefined,
  signal: AbortSignal | undefined,
): Promise<PromptSurfaceAnswer | undefined> {
  // The fallback renders once and cannot re-render, so it neither paints nor
  // offers an expansion; it substitutes a nominal width for the terminal size
  // it is never told, and the host's own select wraps from there.
  const rendered = renderPromptDialog(payload, {
    ...view.budget,
    width: FALLBACK_RENDER_WIDTH,
  });
  const proposeRules: RuleProposer | undefined =
    options?.proposeRules ??
    (view.proposeRules
      ? (instruction, s) => view.proposeRules!(instruction, payload, s)
      : undefined);
  const effectiveOptions: RequestPermissionOptions | undefined =
    proposeRules && !options?.proposeRules
      ? { ...options, proposeRules }
      : options;

  const reevaluateController = options?.reevaluate
    ? new AbortController()
    : undefined;
  let reevaluatedDecision: PermissionPromptDecision | undefined;
  if (options?.reevaluate && reevaluateController) {
    const onWindowAbort = () => reevaluateController.abort();
    signal?.addEventListener("abort", onWindowAbort, { once: true });
    void options
      .reevaluate(reevaluateController.signal)
      .then(
        (decision) => {
          if (!reevaluateController.signal.aborted && decision) {
            reevaluatedDecision = decision;
            reevaluateController.abort();
          }
        },
        () => {},
      )
      .finally(() => {
        signal?.removeEventListener("abort", onWindowAbort);
      });
  }

  const combinedSignal =
    signal && reevaluateController
      ? AbortSignal.any([signal, reevaluateController.signal])
      : (signal ?? reevaluateController?.signal);

  try {
    const answer = await requestPermissionDecisionFromUi(
      view.ui,
      title,
      rendered.lines.join("\n"),
      effectiveOptions,
      combinedSignal,
    );
    if (reevaluatedDecision !== undefined) {
      return reevaluatedDecision;
    }
    return answer;
  } finally {
    reevaluateController?.abort();
  }
}

function attributeToHuman(
  decision: PromptSurfaceAnswer,
  via: UserDecisionSurface,
): PermissionPromptDecision {
  if ("decidedBy" in decision && decision.decidedBy !== undefined) {
    return decision;
  }
  const decidedBy: DecisionSource = { kind: "user", via };
  return { ...decision, decidedBy };
}

/** The width the `select`/`input` fallback renders against. */
const FALLBACK_RENDER_WIDTH = 80;

/** Minimal theme surface the dialog uses; satisfied by the real SDK theme. */
interface PromptTheme {
  fg(color: string, text: string): string;
}

const DEFAULT_SESSION_LABEL = "Yes, for this session";

const OPTION_LABELS: Record<PromptAction, string> = {
  approve: "Yes",
  approveSession: DEFAULT_SESSION_LABEL,
  approveGlobal: "Yes, always allow globally",
  approveSessionBoth: "Yes, for this session in both directions",
  explainAllow: "Explain what to allow (AI proposes safe rule)",
  deny: "No",
  denyWithReason: "No, provide reason",
};

/**
 * Show the inline dialog. The clock's signal dismisses it: an abort closes the
 * dialog and answers `undefined`, so a caller can tell a dismissal from a
 * human answer. The first keystroke engages the clock, stopping it.
 */
export function presentInlinePermissionPrompt(
  view: PermissionPromptView,
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
  clock?: DialogClock,
): Promise<PromptSurfaceAnswer | undefined> {
  const proposeRules: RuleProposer | undefined =
    options?.proposeRules ??
    (view.proposeRules
      ? (instruction, s) => view.proposeRules!(instruction, payload, s)
      : undefined);
  const config: PromptModelConfig = {
    doublePressToConfirm: view.doublePressToConfirm,
    sessionLabel: options?.sessionLabel ?? DEFAULT_SESSION_LABEL,
    widthLabel: options?.sessionWidth?.label,
    sessionScope: options?.sessionScope,
    keys: view.dialogKeys,
    canProposeRules: proposeRules !== undefined,
  };
  return view.ui.custom<PromptSurfaceAnswer | undefined>(
    (tui, theme, keybindings, rawDone) => {
      const reevaluateController = options?.reevaluate
        ? new AbortController()
        : undefined;
      let settled = false;
      const done = (decision: PromptSurfaceAnswer | undefined) => {
        if (settled) return;
        settled = true;
        reevaluateController?.abort();
        rawDone(decision);
      };
      // The host's `done` is idempotent, so a human answer racing the abort
      // settles whichever arrives first.
      clock?.signal?.addEventListener(
        "abort",
        () => {
          done(undefined);
        },
        { once: true },
      );
      // The factory runs once, as the dialog mounts, which is the moment the
      // human is being asked; a re-render does not come back through here.
      const notification = renderPromptNotification(
        view.promptNotifications,
        view.notice,
      );
      if (notification) {
        tui.terminal.write(notification);
      }
      const component = new PermissionPromptComponent(
        theme,
        config,
        title,
        payload,
        view.budget,
        (data) => handleToolsExpandAction(data, keybindings, view.ui),
        () => {
          tui.requestRender();
        },
        done,
        clock,
        proposeRules,
        () => {
          reevaluateController?.abort();
        },
      );
      if (options?.reevaluate && reevaluateController) {
        void options
          .reevaluate(reevaluateController.signal, (source, text) => {
            component.updateAnnotation(source, text);
          })
          .then(
            (decision) => {
              if (!reevaluateController.signal.aborted && decision) {
                done(decision);
              }
            },
            () => {},
          );
      }
      return component;
    },
    { overlay: false },
  );
}

/**
 * Forward Pi's tool-expansion action while the dialog holds keyboard focus.
 *
 * A focused `ctx.ui.custom` component consumes every keystroke, so `Ctrl+O`
 * would otherwise be dead for the duration of an ask — exactly when the user
 * most needs to see the full pending tool invocation. Returns `true` when the
 * keystroke was the action (and was handled), so the caller stops before
 * mapping it to a {@link PromptEvent}; expansion is a display concern and must
 * never reach the decision model.
 *
 * Deliberately does not request a render: `setToolsExpanded` re-renders the
 * host itself, and the dialog's own lines are unaffected by tool expansion.
 */
function handleToolsExpandAction(
  data: string,
  keybindings: PromptKeybindings,
  ui: PermissionPromptUi,
): boolean {
  if (!keybindings.matches(data, "app.tools.expand")) {
    return false;
  }
  ui.setToolsExpanded(!ui.getToolsExpanded());
  return true;
}

class PermissionPromptComponent implements Component {
  private state: PromptViewState;
  /** The denial-reason line editor, rebuilt each time the step is entered. */
  private reason: Input;
  /** The natural-language allow-rule explanation editor. */
  private explain: Input;
  /** Abort controller for an in-flight AI rule proposal. */
  private proposalAbort?: AbortController;
  /** Whether the operator asked to see the complete request (ADR 0011 §4). */
  private expanded = false;

  constructor(
    private readonly theme: PromptTheme,
    private readonly config: PromptModelConfig,
    private readonly title: string,
    private payload: PromptPayload,
    private readonly budget: RenderBudget,
    private readonly handleAppAction: (data: string) => boolean,
    private readonly requestRender: () => void,
    private readonly done: (decision: PromptSurfaceAnswer) => void,
    private readonly clock: DialogClock | undefined,
    private readonly proposeRules?: RuleProposer,
    private readonly onUserInput?: () => void,
  ) {
    this.state = initialPromptState(config);
    this.reason = this.createReasonEditor();
    this.explain = this.createExplainEditor();
  }

  updateAnnotation(source: string, text: string): void {
    const filtered = this.payload.annotations.filter((a) => a.source !== source);
    this.payload = {
      ...this.payload,
      annotations: text ? [...filtered, { source, text }] : filtered,
    };
    this.requestRender();
  }

  /**
   * A fresh editor per visit to the reason step.
   *
   * The framework editor carries an undo stack and a kill ring, so reusing one
   * instance would let a reason the operator backed out of be restored into a
   * later ask.
   */
  private createReasonEditor(): Input {
    const editor = new Input();
    // Emits pi-tui's zero-width cursor marker, which positions the hardware
    // cursor for IME composition.
    editor.focused = true;
    editor.onSubmit = (draft) => {
      this.apply({ type: "submitReason", draft });
    };
    editor.onEscape = () => {
      this.apply({ type: "cancel" });
    };
    return editor;
  }

  private createExplainEditor(): Input {
    const editor = new Input();
    editor.focused = true;
    editor.onSubmit = (draft) => {
      this.apply({ type: "submitExplain", draft });
    };
    editor.onEscape = () => {
      this.apply({ type: "cancel" });
    };
    return editor;
  }

  invalidate(): void {
    // No cached rendering state to clear.
  }

  render(width: number): string[] {
    return fitLinesToWidth(this.renderStep(width), width);
  }

  private renderStep(width: number): string[] {
    switch (this.state.step) {
      case "decision":
        return this.renderDecision(width);
      case "reason":
        return this.renderReason(width);
      case "scope":
        return this.renderScope();
      case "explain":
        return this.renderExplain(width);
      case "proposing":
        return this.renderProposing(width);
      case "proposal":
        return this.renderProposal(width);
    }
  }

  /**
   * The ask itself, bounded to the budget at this frame's width.
   *
   * Rendered per frame rather than once, because the row budget is a function
   * of the width the host gives us, which a resize changes.
   */
  private renderAsk(width: number): DialogView {
    return renderPromptDialog(
      this.payload,
      this.expanded ? completeViewBudget(width) : { ...this.budget, width },
      (text) => this.theme.fg("warning", text),
    );
  }

  /**
   * The key hints, naming the expansion only when it would do something.
   *
   * An affordance advertised when there is nothing to expand is noise; one
   * left unadvertised when the render dropped something is a decision made
   * without the evidence.
   */
  private hint(view: DialogView): string {
    const keys = [
      "↑/↓ move",
      "enter confirm",
      "esc deny",
      "press a letter, then again to confirm",
    ];
    if (this.expanded) {
      keys.push("ctrl+o collapse");
    } else if (view.elided) {
      keys.push("ctrl+o full request");
    }
    const pendingTimeoutMs = this.clock?.pendingTimeoutMs;
    if (pendingTimeoutMs !== undefined) {
      keys.push(`unanswered, denies in ${pendingTimeoutMs / 1000}s`);
    }
    return this.theme.fg("muted", keys.join(" · "));
  }

  handleInput(data: string): void {
    this.engageClock();
    this.onUserInput?.();
    if (this.state.step === "reason") {
      this.handleReasonInput(data);
      return;
    }
    if (this.state.step === "explain") {
      this.handleExplainInput(data);
      return;
    }
    if (this.handleAppAction(data)) {
      // One "expand" for the operator: the host expands its pending tool call
      // and the dialog expands its own render, on the same keystroke.
      this.expanded = !this.expanded;
      this.requestRender();
      return;
    }
    const event = this.toEvent(data);
    if (event) {
      this.apply(event);
    }
  }

  /**
   * Stop the answer window on the human's first keystroke.
   *
   * The window bounds a prompt nobody is attending to; a keystroke proves
   * someone is, so the dialog waits for them to finish rather than vanishing
   * mid-answer. Re-renders so the hint stops advertising a deadline.
   */
  private engageClock(): void {
    if (this.clock?.pendingTimeoutMs === undefined) {
      return;
    }
    this.clock.engage();
    this.requestRender();
  }

  /**
   * Hand the keystroke to the framework line editor.
   *
   * Delegating is what makes the field accept a paste: a paste arrives as one
   * multi-character chunk wrapped in bracketed-paste markers, which the editor
   * understands and a per-character reader cannot. Submit and cancel come back
   * through the editor's callbacks, so the decision model still owns them.
   */
  private handleReasonInput(data: string): void {
    this.reason.handleInput(collapsePastedNewlines(data));
    // The editor mutates its own buffer silently; only the dialog can repaint.
    this.requestRender();
  }

  private handleExplainInput(data: string): void {
    this.explain.handleInput(collapsePastedNewlines(data));
    this.requestRender();
  }

  private toEvent(data: string): PromptEvent | undefined {
    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      return { type: "nav", direction: "up" };
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      return { type: "nav", direction: "down" };
    }
    if (matchesKey(data, "enter")) {
      return { type: "confirm" };
    }
    if (matchesKey(data, "escape")) {
      return { type: "cancel" };
    }
    if (this.state.step === "decision") {
      const action = visibleActions(this.config).find((option) =>
        matchesKey(data, this.boundKey(option)),
      );
      if (action) {
        return { type: "hotkey", action };
      }
    }
    if (this.state.step === "proposal") {
      if (matchesKey(data, "y")) {
        return { type: "proposalHotkey", choice: "saveGlobal" };
      }
      if (matchesKey(data, "s")) {
        return { type: "proposalHotkey", choice: "saveSession" };
      }
      if (matchesKey(data, "e")) {
        return { type: "proposalHotkey", choice: "revise" };
      }
      if (matchesKey(data, "n")) {
        return { type: "proposalHotkey", choice: "back" };
      }
    }
    return undefined;
  }

  private apply(event: PromptEvent): void {
    const prevStep = this.state.step;
    const outcome = reducePrompt(this.config, this.state, event);
    if (prevStep === "proposing" && (outcome.kind === "decision" || outcome.state.step !== "proposing")) {
      this.proposalAbort?.abort();
      this.proposalAbort = undefined;
    }
    if (outcome.kind === "decision") {
      this.done(outcome.decision);
      return;
    }
    if (outcome.state.step === "reason" && prevStep !== "reason") {
      this.reason = this.createReasonEditor();
    }
    if (outcome.state.step === "explain" && prevStep === "decision") {
      this.explain = this.createExplainEditor();
    }
    this.state = outcome.state;
    this.requestRender();
    if (outcome.state.step === "proposing" && prevStep !== "proposing") {
      this.startRuleProposal(outcome.state.explainDraft ?? "");
    }
  }

  private startRuleProposal(draft: string): void {
    if (!this.proposeRules) {
      this.apply({
        type: "proposalFailed",
        error: "Auto-review rule proposer is unavailable.",
      });
      return;
    }
    this.proposalAbort?.abort();
    const controller = new AbortController();
    this.proposalAbort = controller;
    void this.proposeRules(draft, controller.signal).then(
      (proposal) => {
        if (controller.signal.aborted) return;
        this.apply({ type: "proposalReady", proposal });
      },
      (err) => {
        if (controller.signal.aborted) return;
        this.apply({
          type: "proposalFailed",
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
  }

  private renderDecision(width: number): string[] {
    const ask = this.renderAsk(width);
    const lines = [this.theme.fg("accent", this.title), ...ask.lines, ""];
    for (const action of visibleActions(this.config)) {
      const label = this.labelFor(action);
      const selected = this.state.highlightedAction === action;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${this.boundKey(action)}) ${label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    lines.push("");
    lines.push(this.state.hint || this.hint(ask));
    return lines;
  }

  /**
   * The character that selects an option, as a key identifier.
   *
   * The cast is total by construction: a binding is one printable character,
   * which is exactly what pi-tui's matcher accepts as a `KeyId`.
   */
  private boundKey(action: PromptAction): KeyId {
    return this.config.keys[action] as KeyId;
  }

  /**
   * The row label for a key: the two session options carry ask-supplied text
   * naming what they grant, and the rest are fixed.
   */
  private labelFor(action: PromptAction): string {
    if (action === "approveSession") return this.config.sessionLabel;
    if (action === "approveGlobal") {
      return this.config.sessionLabel.includes("for this session")
        ? this.config.sessionLabel.replace("for this session", "always allow globally")
        : `${OPTION_LABELS.approveGlobal}`;
    }
    if (action === "approveSessionBoth") {
      return this.config.widthLabel ?? OPTION_LABELS.approveSessionBoth;
    }
    return OPTION_LABELS[action];
  }

  private renderReason(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      "Reason (required):",
      // Exactly one row, whatever its length: the editor scrolls horizontally.
      ...this.reason.render(width),
    ];
    if (this.state.reasonError) {
      lines.push(this.theme.fg("error", this.state.reasonError));
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "enter submit · esc back"));
    return lines;
  }

  private renderScope(): string[] {
    const scope = this.config.sessionScope;
    const subagentLabel = scope?.subagentLabel ?? "This subagent only";
    const servingLabel = scope?.servingSessionLabel ?? "The whole session";
    const rows: Array<{ label: string; serving: boolean }> = [
      { label: subagentLabel, serving: false },
      { label: servingLabel, serving: true },
    ];
    const lines = [
      this.theme.fg("accent", this.title),
      "Apply this session grant to:",
      "",
    ];
    for (const row of rows) {
      const selected = this.state.scopeServing === row.serving;
      const marker = selected ? "▶" : " ";
      const text = `${marker} ${row.label}`;
      lines.push(selected ? this.theme.fg("accent", text) : text);
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "↑/↓ move · enter confirm · esc back"));
    return lines;
  }

  private renderExplain(width: number): string[] {
    const lines = [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      "Explain in natural language what commands or paths should be allowed:",
      ...this.explain.render(width),
    ];
    if (this.state.explainError) {
      lines.push(this.theme.fg("error", this.state.explainError));
    }
    lines.push("");
    lines.push(this.theme.fg("muted", "enter propose safe rule · esc back"));
    return lines;
  }

  private renderProposing(width: number): string[] {
    return [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      `Explanation: ${this.state.explainDraft ?? ""}`,
      this.theme.fg("warning", "Auto-mode AI is interpreting your rule…"),
      "",
      this.theme.fg("muted", "esc cancel"),
    ];
  }

  private renderProposal(width: number): string[] {
    const proposal = this.state.proposal;
    const ruleLines = (proposal?.grants ?? []).map((g) => {
      const ruleText = `${g.surface}["${g.pattern}"] = ${g.action ?? "allow"}`;
      return `  rule : ${this.theme.fg("warning", ruleText)}`;
    });
    const lines = [
      this.theme.fg("accent", this.title),
      ...this.renderAsk(width).lines,
      "",
      this.theme.fg("accent", "Proposed safe rule (AI):"),
      ...ruleLines,
      ...(proposal?.summary ? [`  why  : ${proposal.summary}`] : []),
      "",
    ];
    const currentChoice = this.state.proposalChoice ?? "saveGlobal";
    const choices: Array<{
      choice: ProposalChoice;
      key: string;
      label: string;
    }> = [
      {
        choice: "saveGlobal",
        key: "y",
        label: "Approve & add rule to safe commands (config.json)",
      },
      {
        choice: "saveSession",
        key: "s",
        label: "Approve & add rule for this session only",
      },
      {
        choice: "revise",
        key: "e",
        label: "Revise explanation",
      },
      {
        choice: "back",
        key: "n",
        label: "Back",
      },
    ];
    for (const item of choices) {
      const selected = currentChoice === item.choice;
      const marker = selected ? "▶" : " ";
      const row = `${marker} (${item.key}) ${item.label}`;
      lines.push(selected ? this.theme.fg("accent", row) : row);
    }
    lines.push("");
    lines.push(
      this.theme.fg("muted", "↑/↓ move · enter/key confirm · esc back"),
    );
    return lines;
  }
}
