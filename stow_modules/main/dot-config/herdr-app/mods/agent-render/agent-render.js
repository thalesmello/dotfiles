// Common agent indicators. No snooze, sorting, or host-state ownership here.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";

export function hasBookmark(labels) {
  // hc-preset maps Pi's `book` metadata token to these core labels. An
  // explicitly cleared token wins over the older compatibility label.
  return Boolean(labels?.["token.book"] ?? labels?.["herdr.book"]);
}

// compact: a ! for blocked where a header already says "Needs you".
export function renderAgentStatus(t, a, compact = false) {
  const color = t[a.status] ?? t.dim;
  if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
  if (a.status === "blocked" && compact) return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
  // Idle: a ring; done: a dot.
  if (a.status === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
  return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? color : t.dim + "00");
}

// A caller may supply an alternative indicator (e.g. a snooze badge).
// Publication always supplements that indicator; it never replaces it.
export function renderAgentIndicators(t, a, { compact = false, bookmarked = false, indicator } = {}) {
  indicator ??= renderAgentStatus(t, a, compact);
  if (!bookmarked) return indicator;
  return h_flex().flex_none().items_center().gap(compact ? 2 : 5)
    .child(div().id(`bookmark-${a.address}`).flex_none().tooltip("Published · ready to settle")
      .child(svg("mods/agent-render/bookmark.svg").size(compact ? 10 : 13).text_color(t.accent)))
    .child(indicator);
}

// Parse generic `badge.*` terminal labels (`text|tone|url|tooltip`) and overlay
// any cached status metadata from `data/agent-badges/state.json`.
export function parseTerminalBadges(labels, badgeCache = {}) {
  if (!labels || typeof labels !== "object") return [];
  const keys = Object.keys(labels)
    .filter((k) => k.startsWith("badge.") && typeof labels[k] === "string" && labels[k].trim())
    .sort();
  const out = [];
  for (const key of keys) {
    const [rawText, rawTone, rawUrl, ...restTooltip] = labels[key].split("|");
    const text = (rawText ?? "").trim();
    if (!text) continue;
    const cached = badgeCache?.[text];
    const labelTooltip = restTooltip.join("|").trim();
    const extraMatch = labelTooltip.match(/(Also:.*)$/);
    const baseTooltip = cached?.tooltip || labelTooltip || text;
    const tooltip = extraMatch && !baseTooltip.includes(extraMatch[1])
      ? `${baseTooltip}\n${extraMatch[1]}`
      : baseTooltip;
    out.push({
      key,
      text,
      tone: cached?.tone || rawTone?.trim() || "accent",
      url: cached?.url || rawUrl?.trim() || "",
      tooltip,
    });
  }
  return out;
}

export function renderAgentBadges(t, address, badges, { onOpen } = {}) {
  if (!badges?.length) return null;
  return h_flex().flex_none().items_center().gap(4).children(
    badges.map((b) => {
      const color = t[b.tone] ?? t.accent ?? t.muted;
      return div()
        .id(`badge-${address}-${b.key}`)
        .flex_none()
        .px(5)
        .py(1)
        .rounded(4)
        .border(1)
        .border_color(color)
        .bg(t.surface ?? t.raised ?? t.chrome)
        .text_size(10)
        .text_color(color)
        .font_semibold()
        .tooltip(b.tooltip)
        .when(Boolean(b.url && onOpen), (el) => el
          .cursor_pointer()
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => {
            cx.stop_propagation();
            onOpen(b.url);
          }))
        .child(b.text);
    }),
  );
}
