import { type ExtensionContext, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import { ModuleLoadMode } from "#core/types";
import { openModulesModal } from "#ui/modules-modal";
import { customPressing, fakeSession as fakeFor, fakeModule, KEY } from "../fakes";

const { SPACE, ENTER, UP } = KEY;

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

function fakeContext(keys: string[], mode = "tui") {
  const custom = customPressing(keys);
  return { ctx: { mode, ui: { custom } } as unknown as ExtensionContext, custom };
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

  it("saves the selection in list order, not toggle order", async () => {
    expect(await press([SPACE, SPACE, UP, ENTER])).toEqual(["a", "c"]);
  });

  // After a Save, the modal reopens on that choice even though /reload hasn't applied it yet.
  it("starts from the selection, not what's running", async () => {
    const session = fakeSession();
    session.moduleManager.select(new Set(["b"]));
    expect(await press([UP, ENTER], session)).toEqual(["b"]);
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
