import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  EXTENSION_ID,
  isYoloModeEnabled,
  type PermissionSystemExtensionConfig,
} from "./extension-config.ts";

export const PERMISSION_SYSTEM_STATUS_KEY = EXTENSION_ID;
export const PERMISSION_SYSTEM_YOLO_STATUS_VALUE = "yolo";

export type EffectivePermissionMode = "auto" | "ask" | "bypassPermissions";

export function getEffectivePermissionMode(
  config: PermissionSystemExtensionConfig,
): EffectivePermissionMode {
  if (isYoloModeEnabled(config)) return "bypassPermissions";
  if ((config.authorizerChain ?? []).includes("auto-review")) return "auto";
  return "ask";
}

type PermissionStatusContext =
  | Pick<ExtensionContext, "hasUI" | "ui">
  | Pick<ExtensionCommandContext, "ui">;

export function getPermissionSystemStatus(
  config: PermissionSystemExtensionConfig,
): string | undefined {
  const mode = getEffectivePermissionMode(config);
  if (mode === "bypassPermissions") return "⏵⏵ bypass permissions";
  if (mode === "auto") return "⏵⏵ auto mode";
  return "⏸ ask mode";
}

export function syncPermissionSystemStatus(
  ctx: PermissionStatusContext,
  config: PermissionSystemExtensionConfig,
): void {
  ctx.ui.setStatus(
    PERMISSION_SYSTEM_STATUS_KEY,
    getPermissionSystemStatus(config),
  );
}
