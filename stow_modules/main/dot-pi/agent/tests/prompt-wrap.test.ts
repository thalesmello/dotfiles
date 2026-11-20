import { expect, test } from "bun:test";
import promptWrapExtension, { installPromptWrap } from "../extensions/prompt-wrap.ts";

test("auto-discovered prompt-wrap exports a harmless extension factory", () => {
	expect(typeof promptWrapExtension).toBe("function");
	expect(promptWrapExtension()).toBeUndefined();
	expect(typeof installPromptWrap).toBe("function");
});
