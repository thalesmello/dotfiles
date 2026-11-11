import type { AuthorizerLog, PermissionQuery } from "../service.ts";
import type {
  AuthorizerVerdict,
  NamedAuthorizer,
  TerminalAuthorizer,
} from "./authorizer.ts";
import type { DecisionSource } from "./decision-source.ts";
import {
  createDeniedPermissionDecision,
  type PermissionPromptDecision,
} from "./permission-dialog.ts";

const DEFAULT_REEVALUATE_BASE_DELAY_MS = 3_000;
const DEFAULT_REEVALUATE_MAX_DELAY_MS = 30_000;
const DEFAULT_SLEEP_CHECK_INTERVAL_MS = 1_000;
const DEFAULT_SLEEP_JUMP_THRESHOLD_MS = 4_000;
const DEFAULT_POST_WAKE_SETTLE_MS = 2_000;

export interface ComposeAuthorizerChainOptions {
  /** Initial delay before background re-evaluation of a transiently-failed link. */
  reevaluateBaseDelayMs?: number;
  /** Maximum backoff delay between background re-evaluation attempts. */
  reevaluateMaxDelayMs?: number;
  /** Interval for checking system sleep/wake clock jumps. */
  sleepCheckIntervalMs?: number;
  /** Wall-clock jump threshold indicating wake from system sleep. */
  sleepJumpThresholdMs?: number;
  /** Settle delay after system wake before running re-evaluation. */
  postWakeSettleMs?: number;
  /** Clock function for testing (defaults to Date.now). */
  clock?: () => number;
}

/**
 * Compose the live-authority chain (ADR 0007): try each non-terminal `link`
 * in order, and on `defer` fall through to the next link, ending at the
 * context-selected `terminal` that always decides.
 *
 * The signature is the type-level terminal-cannot-defer invariant: `links` are
 * deferring {@link NamedAuthorizer}s while `terminal` is a
 * {@link TerminalAuthorizer} (returns a full decision), so a deferring link
 * cannot occupy the terminal slot.
 *
 * Each link is handed the session-scoped `query` and the review-log `log` at
 * `authorize` time (ADR 0007 §3) so it queries the deterministic engine at gate
 * parity and records its decision trail; the terminal receives neither. With
 * zero links the composed chain **is** the terminal instance (identity), so
 * behavior is byte-identical to the pre-chain spine — the empty-links case that
 * ships until a link registers.
 *
 * When a link defers with `transient: true` (e.g. the AI judge timed out while
 * the laptop was closed and resumed), the composed chain attaches a background
 * `reevaluate` hook onto the terminal details so an unattended prompt can keep
 * retrying the transient link(s) across backoff and system sleep/wake transitions.
 */
export function composeAuthorizerChain(
  links: readonly NamedAuthorizer[],
  terminal: TerminalAuthorizer,
  query: PermissionQuery,
  log: AuthorizerLog,
  options?: ComposeAuthorizerChainOptions,
): TerminalAuthorizer {
  if (links.length === 0) {
    return terminal;
  }
  const baseDelayMs =
    options?.reevaluateBaseDelayMs ?? DEFAULT_REEVALUATE_BASE_DELAY_MS;
  const maxDelayMs =
    options?.reevaluateMaxDelayMs ?? DEFAULT_REEVALUATE_MAX_DELAY_MS;
  const sleepCheckIntervalMs =
    options?.sleepCheckIntervalMs ?? DEFAULT_SLEEP_CHECK_INTERVAL_MS;
  const sleepJumpThresholdMs =
    options?.sleepJumpThresholdMs ?? DEFAULT_SLEEP_JUMP_THRESHOLD_MS;
  const postWakeSettleMs =
    options?.postWakeSettleMs ?? DEFAULT_POST_WAKE_SETTLE_MS;
  const clock = options?.clock ?? Date.now;

  return {
    async authorize(details) {
      const deferAnnotations: { source: string; text: string }[] = [];
      const transientLinks: NamedAuthorizer[] = [];
      for (const link of links) {
        const verdict = await link.authorize(details, query, log);
        const decision = decideFromVerdict(link.name, verdict);
        if (decision) {
          return decision;
        }
        // `defer` — try the next link, keeping the link's reason (if any)
        // so the human who is ultimately asked can see why a link that
        // could have decided instead thought they needed to be asked.
        const reason = verdict.kind === "defer" ? verdict.reason?.trim() : "";
        if (reason) {
          deferAnnotations.push({ source: link.name, text: reason });
        }
        if (verdict.kind === "defer" && verdict.transient) {
          transientLinks.push(link);
        }
      }
      const reevaluate =
        transientLinks.length > 0
          ? (
              signal: AbortSignal,
              onUpdateAnnotation?: (source: string, text: string) => void,
            ) =>
              runBackgroundReevaluation({
                transientLinks,
                details,
                query,
                log,
                signal,
                onUpdateAnnotation,
                baseDelayMs,
                maxDelayMs,
                sleepCheckIntervalMs,
                sleepJumpThresholdMs,
                postWakeSettleMs,
                clock,
              })
          : undefined;

      if (deferAnnotations.length === 0 && reevaluate === undefined) {
        return terminal.authorize(details);
      }
      return terminal.authorize({
        ...details,
        ...(reevaluate ? { reevaluate } : {}),
        ...(deferAnnotations.length > 0
          ? {
              payload: {
                ...details.payload,
                annotations: [
                  ...details.payload.annotations,
                  ...deferAnnotations,
                ],
              },
            }
          : {}),
      });
    },
  };
}

interface BackgroundReevaluationParams {
  transientLinks: readonly NamedAuthorizer[];
  details: Parameters<TerminalAuthorizer["authorize"]>[0];
  query: PermissionQuery;
  log: AuthorizerLog;
  signal: AbortSignal;
  onUpdateAnnotation?: (source: string, text: string) => void;
  baseDelayMs: number;
  maxDelayMs: number;
  sleepCheckIntervalMs: number;
  sleepJumpThresholdMs: number;
  postWakeSettleMs: number;
  clock: () => number;
}

async function runBackgroundReevaluation(
  params: BackgroundReevaluationParams,
): Promise<PermissionPromptDecision | null> {
  const {
    details,
    query,
    log,
    signal,
    onUpdateAnnotation,
    baseDelayMs,
    maxDelayMs,
    sleepCheckIntervalMs,
    sleepJumpThresholdMs,
    postWakeSettleMs,
    clock,
  } = params;
  const pending = [...params.transientLinks];
  let currentDelayMs = baseDelayMs;

  while (!signal.aborted && pending.length > 0) {
    const waitResult = await waitForDelayOrWake(
      currentDelayMs,
      signal,
      clock,
      sleepCheckIntervalMs,
      sleepJumpThresholdMs,
    );
    if (waitResult === "aborted" || signal.aborted) {
      return null;
    }
    if (waitResult === "woke") {
      currentDelayMs = baseDelayMs;
      const settleResult = await waitForDelayOrWake(
        postWakeSettleMs,
        signal,
        clock,
        sleepCheckIntervalMs,
        sleepJumpThresholdMs,
      );
      if (settleResult === "aborted" || signal.aborted) {
        return null;
      }
    } else {
      currentDelayMs = Math.min(maxDelayMs, Math.max(baseDelayMs, currentDelayMs * 2));
    }

    for (let i = 0; i < pending.length; ) {
      if (signal.aborted) {
        return null;
      }
      const link = pending[i]!;
      const verdict = await link.authorize(
        { ...details, signal, isReevaluation: true },
        query,
        log,
      );
      if (signal.aborted) {
        return null;
      }
      const decision = decideFromVerdict(link.name, verdict);
      if (decision) {
        return decision;
      }
      const reason = verdict.kind === "defer" ? (verdict.reason?.trim() ?? "") : "";
      if (verdict.kind === "defer" && !verdict.transient) {
        onUpdateAnnotation?.(link.name, reason);
        pending.splice(i, 1);
      } else {
        if (reason) {
          onUpdateAnnotation?.(link.name, reason);
        }
        i += 1;
      }
    }
  }
  return null;
}

function waitForDelayOrWake(
  delayMs: number,
  signal: AbortSignal,
  clock: () => number,
  sleepCheckIntervalMs: number,
  sleepJumpThresholdMs: number,
): Promise<"done" | "woke" | "aborted"> {
  if (signal.aborted) {
    return Promise.resolve("aborted");
  }
  if (delayMs <= 0) {
    return Promise.resolve("done");
  }
  return new Promise((resolve) => {
    let settled = false;
    let lastTick = clock();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const finish = (result: "done" | "woke" | "aborted") => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (interval !== undefined) clearInterval(interval);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = () => finish("aborted");
    signal.addEventListener("abort", onAbort, { once: true });

    const checkWake = (): boolean => {
      const now = clock();
      const delta = now - lastTick;
      lastTick = now;
      if (delta >= sleepJumpThresholdMs) {
        finish("woke");
        return true;
      }
      return false;
    };

    interval = setInterval(checkWake, sleepCheckIntervalMs);
    interval.unref?.();

    timer = setTimeout(() => {
      if (!checkWake()) {
        finish("done");
      }
    }, delayMs);
    timer.unref?.();
  });
}

/**
 * Map a link's decisive verdict to a decision; `defer` yields `null`.
 *
 * The deciding link is named on the decision, not merely counted among the
 * consulted set the selection already records: a link ahead of it that
 * deferred decided nothing and must not be credited (#726).
 */
function decideFromVerdict(
  name: string,
  verdict: AuthorizerVerdict,
): PermissionPromptDecision | null {
  switch (verdict.kind) {
    case "allow":
      // A link grant is non-persistent (state `approved`, never
      // `approved_for_session`), per ADR 0007's off-by-default envelope.
      return {
        approved: true,
        state: "approved",
        decidedBy: decidedByLink(name, "allow", null),
      };
    case "deny":
      return {
        ...createDeniedPermissionDecision(verdict.reason),
        decidedBy: decidedByLink(name, "deny", verdict.reason ?? null),
      };
    case "defer":
      return null;
  }
}

function decidedByLink(
  name: string,
  verdict: "allow" | "deny",
  reason: string | null,
): DecisionSource {
  return { kind: "authorizer", name, verdict, reason };
}
