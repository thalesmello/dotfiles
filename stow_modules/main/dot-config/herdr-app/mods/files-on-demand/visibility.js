import { checking, layout, props } from "herdr";

// A named layout slot follows its ancestors and the selected stack child.
// Overlay copies have their own lifecycle and are visible until they close.
export function visibleMod(root, mod, nodeId = null) {
  if (!root || root.hidden) return false;
  if ((!nodeId || root.id === nodeId) && root.content?.mod === mod) return true;
  const children = root.children ?? [];
  if (root.type === "stack") {
    const shown = children.filter(child => !child.hidden);
    const active = shown.find(child => child.id === root.active) ?? shown[0];
    return visibleMod(active, mod, nodeId);
  }
  return children.some(child => visibleMod(child, mod, nodeId));
}

export function panelVisible(mod) {
  if (checking()) return false;
  const p = props() ?? {};
  if (p.overlay) return true;
  return visibleMod(layout(), mod, p.visibility_node ?? null);
}
