import { type ExtensionContext, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ModuleLoadMode } from "#core/types";
import { openModulesModal } from "#ui/modules-modal";
import { fakeSession as fakeFor, fakeModule } from "../fakes";

const SPACE = " ";
const ENTER = "\r";
const ESCAPE = "\x1b";
const UP = "\x1b[A";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: (result: unknown) => void) => Component;

// Modules a, b and c; a and c are running.
function fakeSession() {
  const { session } = fakeFor();
  session.moduleManager.start(
    [
      fakeModule("a", ModuleLoadMode.ON_LOAD),
      fakeModule("b", ModuleLoadMode.ON_DEMAND),
      fakeModule("c", ModuleLoadMode.ON_LOAD),
    ],
    "startup",
  );
  return session;
}

// Stands in for pi's ctx.ui.custom: builds the component, then presses the keys.
function fakeContext(keys: string[], mode = "tui") {
  const custom = vi.fn(
    (factory: Factory, _options?: { overlay?: boolean }) =>
      new Promise((resolve) => {
        const component = factory({}, theme, {}, resolve);
        for (const key of keys) component.handleInput?.(key);
      }),
  );
  const ctx = { mode, ui: { custom } } as unknown as ExtensionContext;
  return { ctx, custom };
}

/** Opens the modal, presses the keys, and returns the saved names as an array, or `undefined` on Escape. */
async function press(keys: string[], session = fakeSession()) {
  const result = await openModulesModal(fakeContext(keys).ctx, session);
  return result && [...result];
}

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("openModulesModal", () => {
  it("refuses to open outside TUI mode", async () => {
    const { ctx, custom } = fakeContext([], "print");
    await expect(openModulesModal(ctx, fakeSession())).rejects.toThrow("/modules requires TUI mode");
    expect(custom).not.toHaveBeenCalled();
  });

  it("opens as an overlay", async () => {
    const { ctx, custom } = fakeContext([ESCAPE]);
    await openModulesModal(ctx, fakeSession());
    expect(custom.mock.calls[0]?.[1]).toMatchObject({ overlay: true });
  });

  it("saves the selected modules when nothing changed", async () => {
    expect(await press([UP, ENTER])).toEqual(["a", "c"]);
  });

  it("saves the selection in list order, not toggle order", async () => {
    expect(await press([SPACE, SPACE, UP, ENTER])).toEqual(["a", "c"]);
  });

  // After a Save, the modal reopens on that choice even though /reload hasn't applied it yet.
  it("starts from the selection, not what's running", async () => {
    const session = fakeSession();
    session.moduleManager.select(new Set(["b"]));
    expect(await press([UP, ENTER], session)).toEqual(["b"]);
  });

  it("discards the selection on Escape", async () => {
    expect(await press([SPACE, ESCAPE])).toBeUndefined();
  });

  it("locks ALWAYS modules, so toggling them changes nothing", async () => {
    const { session } = fakeFor();
    session.moduleManager.start(
      [fakeModule("core", ModuleLoadMode.ALWAYS), fakeModule("a", ModuleLoadMode.ON_LOAD)],
      "startup",
    );
    expect(await press([SPACE, UP, ENTER], session)).toEqual(["core", "a"]);
  });
});
