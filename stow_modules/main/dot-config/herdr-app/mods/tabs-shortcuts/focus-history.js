// Self-contained focus history / jumplist / attention-jump controller.
// Extracted from spaces-reconnect so pane shortcuts do not depend on the sidebar.
// Herdr rejects cross-mod imports, so everything lives in this file.
//
// Integration (tabs-shortcuts/main.js):
//   import { FocusHistoryController } from "./focus-history.js";
//   this.focusHistory = new FocusHistoryController(); this.focusHistory.init(cx);   // in constructor/init
//   in the nextCommand loop: if (this.focusHistory.handle(cmd)) continue;  // handles focus_back/focus_forward/attention_jump

import { agents, spaces, panes, focused, run, notify, exec, home, shared, setShared, checking } from "herdr";

const isChecking = () => typeof checking === "function" && Boolean(checking());

function paneMachine(p, sp = null) {
  if (sp?.machine) return sp.machine;
  if (p?.machine) return p.machine;
  if (typeof p?.terminal === "string" && p.terminal.includes("/")) return p.terminal.split("/")[0];
  if (typeof p?.pane === "string" && p.pane.includes("/")) return p.pane.split("/")[0];
  if (typeof p?.tab === "string" && p.tab.includes("/")) return p.tab.split("/")[0];
  return null;
}

function qualifyPaneId(paneId, machine = null) {
  const raw = typeof paneId === "string" ? paneId.trim() : "";
  if (!raw) return "";
  if (!machine || raw.includes("/")) return raw;
  return `${machine}/${raw}`;
}

function findSpaceForPane(p, allSpaces) {
  if (!p) return null;
  const pMach = paneMachine(p);
  if (p.tab) {
    const byTabAndMachine = (allSpaces ?? []).find(
      (s) => (s.machine ?? null) === pMach && (s.tabs ?? []).some((t) => t.id === p.tab),
    );
    if (byTabAndMachine) return byTabAndMachine;
    const byTab = (allSpaces ?? []).find((s) => (s.tabs ?? []).some((t) => t.id === p.tab));
    if (byTab) return byTab;
  }
  if (pMach !== null) {
    return (allSpaces ?? []).find((s) => (s.machine ?? null) === pMach) ?? null;
  }
  return null;
}

function canonicalPaneKey(p, allSpaces = null, spHint = null) {
  if (!p) return "";
  const sp = spHint ?? (allSpaces ? findSpaceForPane(p, allSpaces) : null);
  const mach = paneMachine(p, sp);
  return qualifyPaneId(p.pane || p.terminal || "", mach);
}

function panesInTab(allPanes, tabId, space = null) {
  if (!tabId) return allPanes ?? [];
  const mach = space?.machine ?? (tabId.includes("/") ? tabId.split("/")[0] : null);
  const matching = (allPanes ?? []).filter((x) => {
    if (x.tab !== tabId) return false;
    if (space !== null && space !== undefined) {
      const xMach = paneMachine(x);
      if (xMach !== null && mach !== null && xMach !== mach) return false;
      if (mach === null && xMach !== null) return false;
    }
    return true;
  });
  return matching.length ? matching : (allPanes ?? []).filter((x) => x.tab === tabId);
}

function resolveFocusedPane(sp = spaces(), ps = panes(), foc = focused()) {
  const allSpaces = sp ?? [];
  const allPanes = ps ?? [];
  if (!allPanes.length) return null;

  const activeSpace = allSpaces.find((s) => s.active) ?? null;
  const activeTab = activeSpace?.tabs?.find((t) => t.active) ?? null;
  const tabId = activeTab?.id ?? foc?.tab ?? "";
  const tabPanes = tabId ? panesInTab(allPanes, tabId, activeSpace) : allPanes;

  // 1. foc.terminal is always machine-qualified ("t1" vs "devserver/t1") and
  //    never matches an ephemeral overlay terminal (which is not in allPanes).
  if (foc?.terminal) {
    const inTabByTerm = tabPanes.find((x) => x.terminal === foc.terminal);
    if (inTabByTerm) return { pane: inTabByTerm, space: activeSpace ?? findSpaceForPane(inTabByTerm, allSpaces) };
    const anyByTerm = allPanes.find((x) => x.terminal === foc.terminal);
    if (anyByTerm) return { pane: anyByTerm, space: findSpaceForPane(anyByTerm, allSpaces) };
  }

  // 2. foc.pane: check within the active space/tab first so an unqualified "p1"
  //    on a remote machine never collides with local "p1".
  if (foc?.pane) {
    const focMach =
      foc.machine ??
      (typeof foc.terminal === "string" && foc.terminal.includes("/") ? foc.terminal.split("/")[0] : null) ??
      (typeof foc.pane === "string" && foc.pane.includes("/") ? foc.pane.split("/")[0] : null) ??
      activeSpace?.machine ??
      null;
    const wantKey = qualifyPaneId(foc.pane, focMach);
    const inTabByPane = tabPanes.find(
      (x) => x.pane === foc.pane || canonicalPaneKey(x, allSpaces, activeSpace) === wantKey,
    );
    if (inTabByPane) return { pane: inTabByPane, space: activeSpace ?? findSpaceForPane(inTabByPane, allSpaces) };
    const anyByKey = allPanes.find((x) => canonicalPaneKey(x, allSpaces) === wantKey);
    if (anyByKey) return { pane: anyByKey, space: findSpaceForPane(anyByKey, allSpaces) };
    const anyByRaw = allPanes.find((x) => x.pane === foc.pane);
    if (anyByRaw) return { pane: anyByRaw, space: findSpaceForPane(anyByRaw, allSpaces) };
  }

  // 3. Focused flag in active tab, then across all panes.
  const focusedInTab = tabPanes.find((x) => x.focused);
  if (focusedInTab) return { pane: focusedInTab, space: activeSpace ?? findSpaceForPane(focusedInTab, allSpaces) };
  const focusedAnywhere = allPanes.find((x) => x.focused);
  if (focusedAnywhere) return { pane: focusedAnywhere, space: findSpaceForPane(focusedAnywhere, allSpaces) };

  // 4. Single-pane active tab.
  if (tabPanes.length === 1 && tabPanes[0]) {
    return { pane: tabPanes[0], space: activeSpace ?? findSpaceForPane(tabPanes[0], allSpaces) };
  }
  return null;
}

function resolveFocusedPaneId(sp = spaces(), ps = panes(), foc = focused()) {
  const resolved = resolveFocusedPane(sp, ps, foc);
  if (!resolved?.pane) return null;
  return canonicalPaneKey(resolved.pane, sp ?? [], resolved.space) || null;
}

function resolvePaneByKey(targetKey, allSpaces, allPanes) {
  if (!targetKey) return null;
  for (const p of allPanes ?? []) {
    const sp = findSpaceForPane(p, allSpaces);
    const key = canonicalPaneKey(p, allSpaces, sp);
    if (key === targetKey || p.pane === targetKey || p.terminal === targetKey) {
      return { pane: p, space: sp, key };
    }
  }
  return null;
}

function focusResolvedPane(targetObj) {
  if (!targetObj?.pane) return false;
  const { pane: p, space: sp } = targetObj;
  if (sp?.id && !sp.active) {
    run("space.select", { id: sp.id });
  }
  if (p.tab) {
    const tb = (sp?.tabs ?? []).find((t) => t.id === p.tab);
    if (tb && !tb.active) {
      run("tab.select", { id: p.tab });
    }
  }
  const mach = paneMachine(p, sp);
  if (mach && p.terminal && (!p.pane || !String(p.pane).includes("/"))) {
    run("pane.focus", { terminal: p.terminal });
  } else {
    run("pane.focus", { pane: p.pane || p.terminal });
  }
  return true;
}

export class FocusHistoryController {
  constructor() {
    this.pendingHistoryTarget = null;
    this.focusHistory = null;
  }

  init(cx) {
    this.pendingHistoryTarget = null;
    this.initFocusHistory();
    if (isChecking()) return;
    this.syncFocusHistory(Date.now(), spaces(), panes(), focused());
    cx?.timer?.every(250, () => {
      if (isChecking()) return;
      this.syncFocusHistory(Date.now(), spaces(), panes(), focused());
    });
  }

  // Returns true when the command belonged to this controller.
  handle(command) {
    const cmd = typeof command === "string" ? command : command?.command ?? command?.name;
    if (cmd === "focus_back" || cmd === "focus_forward") {
      this.focusJumplist(cmd === "focus_back" ? "back" : "forward", Date.now(), spaces(), panes(), focused(), this.consumePrefixActivePane());
      return true;
    }
    if (cmd === "attention_jump") {
      this.attentionJump(Date.now(), spaces(), panes(), focused(), this.consumePrefixActivePane());
      return true;
    }
    return false;
  }

  initFocusHistory() {
    let loaded = null;
    // Migrate from the sidebar mod's history (localStorage is per-mod) if shared.
    try {
      const sh = typeof shared === "function" ? shared("focusHistory") : null;
      if (sh && typeof sh === "object" && Array.isArray(sh.journal)) loaded = sh;
    } catch {}
    if (!loaded) {
      try {
        loaded = JSON.parse(localStorage.getItem("focusHistory") ?? "null");
      } catch {
        loaded = null;
      }
    }
    this.focusHistory = {
      journal: Array.isArray(loaded?.journal) ? loaded.journal.filter((x) => typeof x === "string" && x) : [],
      seq: typeof loaded?.seq === "number" && loaded.seq >= 0 ? loaded.seq : 0,
      walk: Array.isArray(loaded?.walk) ? loaded.walk.filter((x) => typeof x === "string" && x) : [],
      walkState:
        loaded?.walkState && typeof loaded.walkState === "object" && !Array.isArray(loaded.walkState)
          ? loaded.walkState
          : null,
    };
    if (typeof setShared === "function") setShared("focusHistory", this.focusHistory);
  }

  saveFocusHistory() {
    try {
      localStorage.setItem("focusHistory", JSON.stringify(this.focusHistory));
    } catch {}
    if (typeof setShared === "function") setShared("focusHistory", this.focusHistory);
  }

  consumePrefixActivePane() {
    if (typeof shared !== "function") return null;
    const val = shared("focusHistory.activePane");
    if (val && typeof setShared === "function") setShared("focusHistory.activePane", null);
    return typeof val === "string" && val ? val : null;
  }

  notifyToast(title, body) {
    if (typeof notify === "function") {
      notify({ title, ...(body ? { body } : {}), timeout: 1500 });
    }
  }

  recordFocusPane(paneId, syncDisk = true) {
    if (!this.focusHistory) this.initFocusHistory();
    const id = typeof paneId === "string" ? paneId.trim() : "";
    if (!id) return false;
    const fh = this.focusHistory;
    if (fh.journal.length > 0 && fh.journal[fh.journal.length - 1] === id) {
      return false;
    }
    fh.journal.push(id);
    if (fh.journal.length > 2000) {
      fh.journal = fh.journal.slice(-500);
    }
    fh.seq = (fh.seq || 0) + 1;
    this.saveFocusHistory();
    if (syncDisk && !isChecking() && typeof exec === "function" && typeof home === "function") {
      exec("python3", [`${home()}/.config/herdr/scripts/focus-history-daemon.fish`, "record", id]).catch(() => {});
    }
    return true;
  }

  syncFocusHistory(now = Date.now(), sp = spaces(), ps = panes(), foc = focused()) {
    if (!this.focusHistory) this.initFocusHistory();
    const cur = resolveFocusedPaneId(sp, ps, foc);
    if (!cur) return;
    if (this.pendingHistoryTarget) {
      if (cur === this.pendingHistoryTarget.pane) {
        this.pendingHistoryTarget = null;
      } else if (cur === this.pendingHistoryTarget.fromPane && now < this.pendingHistoryTarget.until) {
        return;
      } else {
        this.pendingHistoryTarget = null;
      }
    }
    this.recordFocusPane(cur);
  }

  focusJumplist(direction, now = Date.now(), sp = spaces(), ps = panes(), foc = focused(), currentOverride = null) {
    if (!this.focusHistory) this.initFocusHistory();
    if (direction !== "back" && direction !== "forward") return false;
    const allSpaces = sp ?? [];
    const allPanes = ps ?? [];
    const liveMap = new Map();
    for (const p of allPanes) {
      const pSpace = findSpaceForPane(p, allSpaces);
      const key = canonicalPaneKey(p, allSpaces, pSpace);
      if (key) liveMap.set(key, { pane: p, space: pSpace, key });
      if (p.pane && !liveMap.has(p.pane)) liveMap.set(p.pane, { pane: p, space: pSpace, key: key || p.pane });
    }
    const resolveKey = (raw) => {
      if (!raw) return "";
      const hit = liveMap.get(raw) ?? resolvePaneByKey(raw, allSpaces, allPanes);
      return hit?.key || raw;
    };

    let current =
      (this.pendingHistoryTarget && now < this.pendingHistoryTarget.until ? this.pendingHistoryTarget.pane : null) ||
      (currentOverride && liveMap.has(resolveKey(currentOverride)) ? resolveKey(currentOverride) : null) ||
      resolveFocusedPaneId(allSpaces, allPanes, foc) ||
      resolveKey(this.focusHistory.journal.at(-1)) ||
      "";
    if (!current) {
      this.notifyToast("Focus jumplist failed", "No focused pane");
      return false;
    }

    this.recordFocusPane(current);

    const fh = this.focusHistory;
    const trail = fh.journal;
    const curSeq = fh.seq;

    let index = -1;
    let walk = [];
    const ws = fh.walkState;
    if (
      ws &&
      typeof ws.index === "number" &&
      resolveKey(ws.expectedPane) === current &&
      typeof ws.seq === "number" &&
      curSeq - ws.seq >= 0 &&
      curSeq - ws.seq <= 1 &&
      Array.isArray(fh.walk) &&
      fh.walk.length > 1
    ) {
      index = ws.index;
      walk = fh.walk.map(resolveKey);
    }

    if (index < 0) {
      if (direction === "forward") {
        this.notifyToast("No forward history");
        return false;
      }
      if (trail.length === 0) {
        this.notifyToast("No focus history yet");
        return false;
      }
      walk = [current];
      for (let i = trail.length - 1; i >= 0; i--) {
        const pKey = resolveKey(trail[i]);
        if (!pKey || walk.includes(pKey) || !liveMap.has(pKey)) continue;
        walk.push(pKey);
      }
      if (walk.length <= 1) {
        fh.walk = [];
        fh.walkState = null;
        this.saveFocusHistory();
        this.notifyToast("Start of focus history");
        return false;
      }
      index = 0;
      fh.walk = walk;
    }

    let targetIndex = index;
    while (true) {
      if (direction === "back") {
        targetIndex += 1;
        if (targetIndex >= walk.length) {
          fh.walkState = { index, expectedPane: current, seq: curSeq };
          this.saveFocusHistory();
          this.notifyToast("Start of focus history");
          return false;
        }
      } else {
        targetIndex -= 1;
        if (targetIndex < 0) {
          fh.walkState = { index, expectedPane: current, seq: curSeq };
          this.saveFocusHistory();
          this.notifyToast("End of focus history");
          return false;
        }
      }
      if (liveMap.has(walk[targetIndex])) break;
    }

    const target = walk[targetIndex];
    const targetObj = liveMap.get(target) ?? resolvePaneByKey(target, allSpaces, allPanes);
    this.pendingHistoryTarget = { pane: target, fromPane: current, until: now + 1500 };
    if (targetObj) {
      focusResolvedPane(targetObj);
    } else {
      run("pane.focus", { pane: target });
    }
    this.recordFocusPane(target);
    fh.walkState = { index: targetIndex, expectedPane: target, seq: fh.seq };
    this.saveFocusHistory();

    const steps = targetIndex;
    if (direction === "back") {
      this.notifyToast(`← ${target}`, `${steps} back`);
    } else if (steps === 0) {
      this.notifyToast(`→ ${target}`);
    } else {
      this.notifyToast(`→ ${target}`, `${steps} back`);
    }
    return true;
  }

  attentionJump(now = Date.now(), sp = spaces(), ps = panes(), foc = focused(), currentOverride = null) {
    if (!this.focusHistory) this.initFocusHistory();
    const allSpaces = sp ?? [];
    const allPanes = ps ?? [];
    const liveMap = new Map();
    for (const p of allPanes) {
      const pSpace = findSpaceForPane(p, allSpaces);
      const key = canonicalPaneKey(p, allSpaces, pSpace);
      if (key) liveMap.set(key, { pane: p, space: pSpace, key });
      if (p.terminal) liveMap.set(p.terminal, { pane: p, space: pSpace, key: key || p.pane });
      if (p.pane && !liveMap.has(p.pane)) liveMap.set(p.pane, { pane: p, space: pSpace, key: key || p.pane });
    }
    const resolveKey = (raw) => {
      if (!raw) return "";
      const hit = liveMap.get(raw) ?? resolvePaneByKey(raw, allSpaces, allPanes);
      return hit?.key || raw;
    };

    const currentPane =
      (this.pendingHistoryTarget && now < this.pendingHistoryTarget.until ? this.pendingHistoryTarget.pane : null) ||
      (currentOverride && liveMap.has(resolveKey(currentOverride)) ? resolveKey(currentOverride) : null) ||
      resolveFocusedPaneId(allSpaces, allPanes, foc) ||
      resolveKey(this.focusHistory.journal.at(-1)) ||
      "";
    if (currentPane) this.recordFocusPane(currentPane);

    const agentList = (typeof agents === "function" ? agents() : null) ?? [];
    const snoozeState = (typeof shared === "function" ? shared("agents.snooze") : null) ?? {};
    const snoozePanes = snoozeState.panes ?? {};
    const snoozeWorkspaces = snoozeState.workspaces ?? {};
    const isSnoozed = (a, pKey) => {
      const pEntry =
        snoozePanes[pKey] ??
        snoozePanes[a.pane] ??
        Object.values(snoozePanes).find((e) => e?.terminal_id === a.address);
      if (pEntry && pEntry.until > now) return true;
      const wEntry = a.space ? snoozeWorkspaces[a.space] : null;
      return Boolean(wEntry && wEntry.until > now);
    };

    let changed = {};
    try {
      changed = JSON.parse(localStorage.getItem("changed") ?? "{}") ?? {};
    } catch {
      changed = {};
    }

    const candidates = [];
    for (let i = 0; i < agentList.length; i++) {
      const a = agentList[i];
      const targetObj = (a?.address && liveMap.get(a.address)) || (a?.pane && liveMap.get(a.pane)) || null;
      if (!targetObj) continue;
      const pKey = targetObj.key;
      if (isSnoozed(a, pKey)) continue;
      const status = a.status === "error" ? "blocked" : a.status;
      if (status !== "blocked" && status !== "done") continue;
      const since = changed[a.address]?.at ?? 0;
      const seq = a.seq ?? 0;
      candidates.push({
        agent: a,
        targetObj,
        paneKey: pKey,
        status,
        pinned: Boolean(a.pinned),
        since,
        seq,
        index: i,
        focused: currentPane ? pKey === currentPane : Boolean(a.focused),
      });
    }

    candidates.sort((x, y) => {
      if (x.pinned !== y.pinned) return x.pinned ? -1 : 1;
      if (x.status !== y.status) return x.status === "blocked" ? -1 : 1;
      if (y.since !== x.since) return y.since - x.since;
      if (y.seq !== x.seq) return y.seq - x.seq;
      return x.index - y.index;
    });

    const focIdx = candidates.findIndex((c) => c.focused);
    const rotated =
      focIdx >= 0 ? [...candidates.slice(focIdx + 1), ...candidates.slice(0, focIdx)] : candidates;
    const picked = rotated.filter((c) => !c.focused);

    if (picked.length === 0) {
      return this.focusJumplist("forward", now, allSpaces, allPanes, foc, currentPane);
    }

    const chosen = picked[0];
    const targetPane = chosen.paneKey;
    const kind = chosen.agent.program?.key || chosen.agent.program?.name?.toLowerCase() || chosen.agent.app || "agent";
    const label = `${kind} ${chosen.status}`;

    this.pendingHistoryTarget = { pane: targetPane, fromPane: currentPane, until: now + 1500 };
    focusResolvedPane(chosen.targetObj);
    this.recordFocusPane(targetPane);

    const others = picked.length - 1;
    this.notifyToast(others > 0 ? `→ ${label} (+${others} more)` : `→ ${label}`);
    return true;
  }

}
