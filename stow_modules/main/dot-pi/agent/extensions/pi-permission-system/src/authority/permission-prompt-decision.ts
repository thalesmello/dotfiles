import type { DialogKeyBindings, PromptAction } from "../config/dialog-keys.ts";
import type { SessionGrantWidth } from "../session/approval-grant.ts";
import {
  createDeniedPermissionDecision,
  normalizePermissionDenialReason,
  type RequestPermissionOptions,
  type RuleProposal,
  type UnattributedDecision,
} from "./permission-dialog.ts";

/**
 * Pure decision model for the inline keybind permission dialog.
 *
 * The interaction logic — which hotkey produces which decision, double-press
 * arming, step transitions, and reason validation — lives here with no SDK or
 * TUI imports, so it is unit-testable directly. The `ctx.ui.custom` component
 * ({@link file://./permission-prompt-component.ts}) is a thin adapter that
 * forwards keystrokes to {@link reducePrompt} and renders the returned state.
 */

/** Which sub-view the dialog is showing. */
export type PromptStep =
  | "decision"
  | "reason"
  | "scope"
  | "explain"
  | "proposing"
  | "proposal";

export type ProposalChoice = "saveGlobal" | "saveSession" | "revise" | "back";

export const PROPOSAL_CHOICES: readonly ProposalChoice[] = [
  "saveGlobal",
  "saveSession",
  "revise",
  "back",
];

/**
 * The decisions in display order.
 *
 * `approveSessionBoth` is conditional: it appears only for an ask whose session
 * grant can be widened to both directions (#813), so the roster an ask actually
 * offers comes from {@link visibleActions} rather than from this list.
 */
const OPTION_ORDER: readonly PromptAction[] = [
  "approve",
  "approveSession",
  "approveGlobal",
  "approveSessionBoth",
  "explainAllow",
  "deny",
  "denyWithReason",
];

/**
 * The decision step's options, in display order.
 *
 * A function of the config rather than an exported constant, so which options
 * an ask offers is decided in the model and the component renders whatever it
 * is handed — two copies of the roster would be two places to teach about a
 * conditional option.
 *
 * The width option is offered iff the ask supplied a label for it, so an ask
 * that proves no single direction is rendered and navigated exactly as before.
 */
export function visibleActions(
  config: PromptModelConfig,
): readonly PromptAction[] {
  return OPTION_ORDER.filter((action) => {
    if (action === "approveSessionBoth" && !config.widthLabel) return false;
    if (action === "explainAllow" && config.canProposeRules === false) {
      return false;
    }
    return true;
  });
}

const OPTION_VERBS: Record<PromptAction, string> = {
  approve: "approve",
  approveSession: "approve for this session",
  approveGlobal: "always allow globally",
  approveSessionBoth: "approve both directions for this session",
  explainAllow: "explain what should be allowed",
  deny: "deny",
  denyWithReason: "deny with a reason",
};

/** Static configuration for a single prompt presentation. */
export interface PromptModelConfig {
  /** When true, a hotkey arms first and commits only on a second press. */
  doublePressToConfirm: boolean;
  /**
   * The character bound to each decision.
   *
   * What the dialog matches keystrokes against and what it renders, so an
   * option's identity and the key that selects it are separate values.
   */
  keys: DialogKeyBindings;
  /** Label shown beside the approve-for-session option. */
  sessionLabel: string;
  /**
   * Label for the both-directions session option (#813).
   *
   * Its presence is what offers the option: an ask whose grants prove no
   * single direction supplies none, and the roster stays four keys.
   */
  widthLabel?: string;
  /**
   * Forwarded asks only: when set, confirming `s` opens a second step choosing
   * whether the grant applies to the requesting subagent only (least-privilege
   * default) or the whole serving session.
   */
  sessionScope?: NonNullable<RequestPermissionOptions["sessionScope"]>;
  /** Whether the natural-language rule proposer is available (default: true). */
  canProposeRules?: boolean;
}

/** The re-render view state the component draws from. */
export interface PromptViewState {
  step: PromptStep;
  highlightedAction: PromptAction;
  /** Set only while awaiting the confirming second press of a hotkey. */
  armedAction?: PromptAction;
  /** "Press y again to approve." while armed; empty otherwise. */
  hint: string;
  /** Set when an empty reason submit is rejected. */
  reasonError?: string;
  /** Natural-language rule explanation draft, error, and proposed rule state. */
  explainDraft?: string;
  explainError?: string;
  proposal?: RuleProposal;
  proposalChoice?: ProposalChoice;
  /** Scope step: false = subagent-only (default), true = whole serving session. */
  scopeServing: boolean;
  /**
   * The width the session option chosen so far would grant.
   *
   * Held on the state rather than passed to the scope step, because a
   * forwarded ask commits the two choices in different steps. Reset to
   * `"proven"` on every return to the decision step, so a width the user
   * backed out of cannot ride along with a later narrow choice.
   */
  grantWidth: SessionGrantWidth;
}

/** An input event the reducer understands. */
export type PromptEvent =
  | { type: "nav"; direction: "up" | "down" }
  | { type: "hotkey"; action: PromptAction }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "submitReason"; draft: string }
  | { type: "submitExplain"; draft: string }
  | { type: "proposalReady"; proposal: RuleProposal }
  | { type: "proposalFailed"; error: string }
  | { type: "proposalHotkey"; choice: ProposalChoice };

/** Either a re-render or a terminal decision. */
export type PromptOutcome =
  | { kind: "render"; state: PromptViewState }
  | { kind: "decision"; decision: UnattributedDecision };

export function initialPromptState(
  _config: PromptModelConfig,
): PromptViewState {
  return {
    step: "decision",
    highlightedAction: "approve",
    armedAction: undefined,
    hint: "",
    reasonError: undefined,
    scopeServing: false,
    grantWidth: "proven",
  };
}

/**
 * Advance the dialog by one input event, returning either the next view state
 * to render or the committed {@link UnattributedDecision}.
 *
 * The model states the outcome and not the decider: which human surface this
 * is gets attributed by the dispatcher that chose to render this dialog, so
 * the two cannot disagree about the surface.
 */
export function reducePrompt(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (state.step) {
    case "decision":
      return reduceDecisionStep(config, state, event);
    case "reason":
      return reduceReasonStep(state, event);
    case "scope":
      return reduceScopeStep(state, event);
    case "explain":
      return reduceExplainStep(config, state, event);
    case "proposing":
      return reduceProposingStep(state, event);
    case "proposal":
      return reduceProposalStep(state, event);
  }
}

function reduceDecisionStep(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (event.type) {
    case "nav":
      return render({
        ...state,
        highlightedAction: shiftAction(
          config,
          state.highlightedAction,
          event.direction,
        ),
        armedAction: undefined,
        hint: "",
      });
    case "hotkey":
      return visibleActions(config).includes(event.action)
        ? pressHotkey(config, state, event.action)
        : render(state);
    case "confirm":
      return commit(config, state, state.highlightedAction);
    case "cancel":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "submitReason":
    case "submitExplain":
    case "proposalReady":
    case "proposalFailed":
    case "proposalHotkey":
      return render(state);
  }
}

function pressHotkey(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptAction,
): PromptOutcome {
  // Opening the natural-language explain editor does not commit an allow/deny
  // decision on its own, so enter the editor on the first press.
  if (
    action === "explainAllow" ||
    !config.doublePressToConfirm ||
    state.armedAction === action
  ) {
    return commit(config, state, action);
  }
  return render({
    ...state,
    highlightedAction: action,
    armedAction: action,
    hint: `Press ${config.keys[action]} again to ${OPTION_VERBS[action]}.`,
  });
}

function commit(
  config: PromptModelConfig,
  state: PromptViewState,
  action: PromptAction,
): PromptOutcome {
  switch (action) {
    case "approve":
      return {
        kind: "decision",
        decision: { approved: true, state: "approved" },
      };
    case "deny":
      return { kind: "decision", decision: createDeniedPermissionDecision() };
    case "denyWithReason":
      return render({
        ...state,
        step: "reason",
        highlightedAction: "denyWithReason",
        armedAction: undefined,
        hint: "",
        reasonError: undefined,
      });
    case "explainAllow":
      return render({
        ...state,
        step: "explain",
        highlightedAction: "explainAllow",
        armedAction: undefined,
        hint: "",
        explainError: undefined,
      });
    case "approveGlobal":
      return {
        kind: "decision",
        decision: {
          ...sessionDecision("approved_for_session", "proven"),
          persistGlobal: true,
        },
      };
    case "approveSession":
    case "approveSessionBoth": {
      // The two session options differ only in the width they grant; which
      // scope they land on is the forwarded scope step's separate question.
      const grantWidth: SessionGrantWidth =
        action === "approveSessionBoth" ? "family" : "proven";
      if (config.sessionScope) {
        return render({
          ...state,
          step: "scope",
          highlightedAction: action,
          armedAction: undefined,
          hint: "",
          scopeServing: false,
          grantWidth,
        });
      }
      return {
        kind: "decision",
        decision: sessionDecision("approved_for_session", grantWidth),
      };
    }
  }
}

/**
 * A session-granting decision, naming its width only when it is not the
 * default.
 *
 * Absent means `"proven"` everywhere this value travels — the decision, the
 * gate result, and the forwarded wire — so the narrow grant serializes
 * exactly as it did before the option existed.
 */
function sessionDecision(
  state: "approved_for_session" | "approved_for_serving_session",
  width: SessionGrantWidth,
): UnattributedDecision {
  return {
    approved: true,
    state,
    ...(width === "family" ? { sessionGrantWidth: width } : {}),
  };
}

function reduceReasonStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") {
    return render({
      ...state,
      step: "decision",
      armedAction: undefined,
      hint: "",
      reasonError: undefined,
      grantWidth: "proven",
    });
  }
  if (event.type === "submitReason") {
    const reason = normalizePermissionDenialReason(event.draft);
    if (reason === undefined) {
      return render({
        ...state,
        reasonError: "A reason is required.",
      });
    }
    return {
      kind: "decision",
      decision: createDeniedPermissionDecision(reason),
    };
  }
  return render(state);
}

function reduceExplainStep(
  config: PromptModelConfig,
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") {
    return render({
      ...state,
      step: "decision",
      armedAction: undefined,
      hint: "",
      explainError: undefined,
      grantWidth: "proven",
    });
  }
  if (event.type === "submitExplain") {
    const draft = event.draft.trim();
    if (!draft) {
      return render({
        ...state,
        explainError: "Describe in natural language what should be allowed.",
      });
    }
    if (config.canProposeRules === false) {
      return render({
        ...state,
        explainError: "Auto-review rule proposer is unavailable.",
      });
    }
    return render({
      ...state,
      step: "proposing",
      explainDraft: draft,
      explainError: undefined,
      proposal: undefined,
    });
  }
  return render(state);
}

function reduceProposingStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  if (event.type === "cancel") {
    return render({
      ...state,
      step: "explain",
      explainError: undefined,
    });
  }
  if (event.type === "proposalReady") {
    if (event.proposal.grants.length === 0) {
      return render({
        ...state,
        step: "explain",
        explainError: "Could not derive a rule from that description. Try being more specific.",
      });
    }
    return render({
      ...state,
      step: "proposal",
      proposal: event.proposal,
      proposalChoice: "saveGlobal",
      explainError: undefined,
    });
  }
  if (event.type === "proposalFailed") {
    return render({
      ...state,
      step: "explain",
      explainError: event.error || "Failed to propose a rule.",
    });
  }
  return render(state);
}

function reduceProposalStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  const currentChoice = state.proposalChoice ?? "saveGlobal";
  switch (event.type) {
    case "nav": {
      const idx = PROPOSAL_CHOICES.indexOf(currentChoice);
      const delta = event.direction === "down" ? 1 : -1;
      const next =
        PROPOSAL_CHOICES[
          (idx + delta + PROPOSAL_CHOICES.length) % PROPOSAL_CHOICES.length
        ] ?? "saveGlobal";
      return render({ ...state, proposalChoice: next });
    }
    case "proposalHotkey":
      return commitProposalChoice(state, event.choice);
    case "confirm":
      return commitProposalChoice(state, currentChoice);
    case "cancel":
      return render({
        ...state,
        step: "decision",
        armedAction: undefined,
        hint: "",
        explainError: undefined,
        grantWidth: "proven",
      });
    default:
      return render(state);
  }
}

function commitProposalChoice(
  state: PromptViewState,
  choice: ProposalChoice,
): PromptOutcome {
  const grants = state.proposal?.grants ?? [];
  switch (choice) {
    case "saveGlobal":
      return {
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_session",
          persistGlobal: true,
          customGrants: grants,
        },
      };
    case "saveSession":
      return {
        kind: "decision",
        decision: {
          approved: true,
          state: "approved_for_session",
          customGrants: grants,
        },
      };
    case "revise":
      return render({
        ...state,
        step: "explain",
        explainError: undefined,
      });
    case "back":
      return render({
        ...state,
        step: "decision",
        armedAction: undefined,
        hint: "",
        explainError: undefined,
        grantWidth: "proven",
      });
  }
}

function reduceScopeStep(
  state: PromptViewState,
  event: PromptEvent,
): PromptOutcome {
  switch (event.type) {
    case "nav":
      return render({ ...state, scopeServing: event.direction === "down" });
    case "confirm":
      return {
        kind: "decision",
        decision: sessionDecision(
          state.scopeServing
            ? "approved_for_serving_session"
            : "approved_for_session",
          state.grantWidth,
        ),
      };
    case "cancel":
      return render({
        ...state,
        step: "decision",
        armedAction: undefined,
        hint: "",
        grantWidth: "proven",
      });
    default:
      return render(state);
  }
}

function shiftAction(
  config: PromptModelConfig,
  current: PromptAction,
  direction: "up" | "down",
): PromptAction {
  const actions = visibleActions(config);
  const index = actions.indexOf(current);
  const delta = direction === "down" ? 1 : -1;
  const next = (index + delta + actions.length) % actions.length;
  return actions[next] ?? current;
}

function render(state: PromptViewState): PromptOutcome {
  return { kind: "render", state };
}
