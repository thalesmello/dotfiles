import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../extensions/pi-permission-system/src/config/config-store.ts";
import { getEffectivePermissionMode } from "../extensions/pi-permission-system/src/config/status.ts";

// Regression: Shift+Tab cycling sets a session mode via setInMemory, but
// SessionTurnPrep refreshes the config from disk on every before_agent_start.
// The refresh must not clobber the session mode back to the global startup
// default (config.json yoloMode:true == bypassPermissions).
function makeStore(globalConfig: Record<string, unknown>) {
	const agentDir = mkdtempSync(join(tmpdir(), "perm-config-store-"));
	const configDir = join(agentDir, "extensions", "pi-permission-system");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "config.json"), JSON.stringify(globalConfig));
	const store = new ConfigStore({
		agentDir,
		policyPaths: { getResolvedPolicyPaths: () => ({}) as never },
		logger: { debug() {}, review() {} } as never,
		coreCommandWords: new Set<string>(),
		wrapperCommandWords: new Set<string>(),
	});
	const ctx = { ui: { setStatus() {} } } as never;
	return { store, ctx };
}

const BYPASS_GLOBAL = { yoloMode: true, authorizerChain: ["auto-review"] };

describe("ConfigStore session mode", () => {
	test("global config is the startup default", () => {
		const { store } = makeStore(BYPASS_GLOBAL);
		store.refresh(undefined, false);
		expect(getEffectivePermissionMode(store.current())).toBe("bypassPermissions");
	});

	test("session mode survives a refresh from disk", () => {
		const { store, ctx } = makeStore(BYPASS_GLOBAL);
		store.refresh(undefined, false);
		// Shift+Tab to "ask": yoloMode off, no authorizer chain.
		store.setInMemory(
			{ ...store.current(), yoloMode: false, authorizerChain: [] },
			ctx,
		);
		expect(getEffectivePermissionMode(store.current())).toBe("ask");

		// Every turn refreshes from disk; the session mode must persist.
		store.refresh(undefined, false);
		store.refresh(undefined, false);
		expect(getEffectivePermissionMode(store.current())).toBe("ask");
		expect(store.current().yoloMode).toBe(false);
	});

	test("save() persists a mode and clears the session override", async () => {
		const { store, ctx } = makeStore(BYPASS_GLOBAL);
		store.refresh(undefined, false);
		store.setInMemory(
			{ ...store.current(), yoloMode: false, authorizerChain: [] },
			ctx,
		);
		// Persist bypass as the new global default...
		await store.save(
			{ ...store.current(), yoloMode: true, authorizerChain: ["auto-review"] },
			ctx,
		);
		// ...so a later refresh follows disk again, not the old override.
		store.refresh(undefined, false);
		expect(getEffectivePermissionMode(store.current())).toBe("bypassPermissions");
	});
});
