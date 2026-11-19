import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const modsRoot = new URL("../stow_modules/main/dot-config/herdr-app/mods/", import.meta.url);

function tree(mod: string, hidden = false, active = "files") {
  return { id: "root", type: "row", children: [{ id: "panel", type: "column", hidden, children: [
    { id: "panel-body", type: "stack", active, children: [
      { id: "files", type: "block", content: { mod: "files-on-demand" } },
      { id: "changes", type: "block", content: { mod: "changes-on-demand" } },
    ] },
  ] }] };
}

for (const name of ["files-on-demand", "changes-on-demand"]) {
  const code = await readFile(new URL(`${name}/main.js`, modsRoot), "utf8");
  const visibility = await readFile(new URL(`${name}/visibility.js`, modsRoot), "utf8");
  const clean = (s: string) => s.replace(/^import .*;\n/gm, "");
  const visibleMod = new Function(`${clean(visibility).replace(/export /g, "")}; return visibleMod;`)();

  function fixture(options: { local?: boolean; checking?: boolean; intercept?: Function } = {}) {
    let hidden = true, now = 100000;
    const calls: string[][] = [], tasks: Promise<unknown>[] = [], errors: unknown[] = [];
    const timers: { ms: number; callback: Function }[] = [];
    const watches: { cancelled: boolean; promise: Promise<unknown> }[] = [];
    const slot = name === "files-on-demand" ? "files" : "changes";
    const layout = () => tree(name, hidden, slot);
    const props = () => ({ visibility_node: slot });
    const checking = () => Boolean(options.checking);
    const panelVisible = new Function("checking", "layout", "props", `${clean(visibility).replace(/export /g, "")}; return panelVisible;`)(checking, layout, props);
    const exec = async (cmd: string, args: string[], opts: unknown) => {
      calls.push([cmd, ...args]);
      const intercepted = options.intercept?.(cmd, args, opts);
      if (intercepted) return intercepted;
      if (cmd === "sh") return { code: 0, stdout: "f\0hello.txt\0", stderr: "" };
      if (args.includes("--show-toplevel")) return { code: 0, stdout: "/repo\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    };
    const watchFolder = () => {
      let resolve: Function;
      const record = { cancelled: false, promise: null as unknown as Promise<unknown> };
      const p = new Promise(r => { resolve = r; }) as Promise<unknown> & { cancel: Function };
      p.cancel = () => { record.cancelled = true; resolve([]); };
      record.promise = p; watches.push(record); return p;
    };
    const cx = {
      timer: { every: (ms: number, callback: Function) => timers.push({ ms, callback }) },
      spawn: (f: Function) => { const t = f(cx); tasks.push(Promise.resolve(t).catch(e => errors.push(e))); },
      notify() {}, focus_handle: () => ({}),
    };
    const input = { on() {}, set_value() {} };
    const mocks: Record<string, unknown> = {
      View: class {}, spaces: () => [{ id: "space", active: true, machine: options.local ? null : "devserver", folder: "/repo" }],
      panes: () => [{ pane: "pane", cwd: "/repo" }], focused: () => ({ pane: "pane", cwd: "/repo" }),
      exec, readTextFile: async () => "hello", watchFolder, theme: () => ({}), settings: () => ({}), window: () => ({}),
      panelVisible, InputState: { new: () => input }, Date: { now: () => now },
    };
    const source = clean(code).replace("export default class", "return class");
    const Class = new Function(...Object.keys(mocks), source)(...Object.values(mocks));
    const instance = new Class();
    instance.init({}, cx);
    const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); expect(errors).toEqual([]); };
    const tick = async (delta = 1000) => { now += delta; timers.forEach(t => t.callback(cx)); await drain(); };
    return { instance, cx, calls, watches, timers, drain, tick, show: () => { hidden = false; }, hide: () => { hidden = true; } };
  }

  describe(name, () => {
    test("visibility follows hidden ancestors, stack selection, and hidden selected-child fallback", () => {
      expect(visibleMod(tree(name, true, "files"), name)).toBe(false);
      expect(visibleMod(tree(name, false, "files"), name)).toBe(name.startsWith("files"));
      expect(visibleMod(tree(name, false, "changes"), name)).toBe(name.startsWith("changes"));
      const root = tree(name, false, "changes");
      (root.children[0].children[0].children[1] as any).hidden = true;
      expect(visibleMod(root, name)).toBe(name.startsWith("files"));
      expect(visibleMod(root, name, "missing-slot")).toBe(false);
    });

    test("hidden initialization and ticks issue no remote commands; showing resumes bounded polling", async () => {
      const f = fixture();
      await f.drain();
      for (let i = 0; i < 20; i++) await f.tick();
      expect(f.calls).toHaveLength(0);
      f.show(); await f.tick();
      const count = f.calls.length;
      expect(count).toBe(name.startsWith("files") ? 3 : 4);
      for (let i = 0; i < 9; i++) await f.tick();
      expect(f.calls).toHaveLength(count);
      await f.tick(); expect(f.calls.length).toBeGreaterThan(count);
      f.hide(); await f.tick(); const hiddenCount = f.calls.length;
      for (let i = 0; i < 20; i++) await f.tick();
      expect(f.calls).toHaveLength(hiddenCount);
      f.show(); await f.tick(); expect(f.calls.length).toBeGreaterThan(hiddenCount);
      f.instance.close();
    });

    test("hiding during an in-flight read prevents subsequent Git commands", async () => {
      let resolve: Function;
      const blocked = new Promise(r => { resolve = r; });
      const f = fixture({ intercept: () => blocked });
      f.show(); f.instance.activity(f.cx); await f.drain();
      expect(f.calls).toHaveLength(1);
      f.hide(); f.instance.activity(f.cx);
      resolve!({ code: 0, stdout: name.startsWith("files") ? "f\0hello.txt\0" : "/repo\n", stderr: "" });
      await f.drain(); expect(f.calls).toHaveLength(1);
      expect(f.instance.loading).toBe(false);
    });

    if (name.startsWith("files")) test("remote Windows fallback does not start PowerShell after hiding", async () => {
      let reject: Function;
      const blocked = new Promise((_resolve, r) => { reject = r; });
      const f = fixture({ intercept: () => blocked });
      f.show(); f.instance.activity(f.cx); await f.drain();
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0][0]).toBe("sh");
      f.hide(); f.instance.activity(f.cx);
      reject!(new Error("herdr.exec: cannot start sh: program not found"));
      await f.drain();
      expect(f.calls).toHaveLength(1);
      expect(f.instance.loading).toBe(false);
    });

    test("local pending folder watches cancel on hiding and close, without restarting", async () => {
      const f = fixture({ local: true });
      f.show(); await f.tick();
      expect(f.watches).toHaveLength(1);
      f.hide(); await f.tick(); expect(f.watches[0].cancelled).toBe(true);
      for (let i = 0; i < 5; i++) await f.tick();
      expect(f.watches).toHaveLength(1);
      f.show(); await f.tick(); expect(f.watches).toHaveLength(2);
      f.instance.close(); await f.drain(); expect(f.watches[1].cancelled).toBe(true);
      expect(f.watches).toHaveLength(2);
    });

    test("checker never starts machine work even when its layout slot is visible", async () => {
      const f = fixture({ checking: true });
      f.show(); await f.tick(); expect(f.calls).toHaveLength(0); expect(f.watches).toHaveLength(0);
    });
  });
}
