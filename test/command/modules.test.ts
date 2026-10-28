import { type ExtensionCommandContext, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import { modulesCmd } from "#command/modules";
import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import { customPressing, fakeModule, fakeSessionWithModules, KEY } from "../fakes";

const { SPACE, ENTER, UP, ESCAPE } = KEY;

// Modules a and b; only a is running.
function fakeSession() {
  return fakeSessionWithModules([fakeModule("a", ModuleLoadMode.ON_LOAD), fakeModule("b", ModuleLoadMode.ON_DEMAND)]);
}

function fakeContext(mode: string, keys: string[] = []) {
  const custom = customPressing(keys);
  return { ctx: { mode, ui: { custom } } as unknown as ExtensionCommandContext, custom };
}

const selected = (session: Session) => session.moduleManager.moduleInfos.filter((m) => m.isSelected).map((m) => m.name);

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("/modules", () => {
  it("lists each module with whether it's running", async () => {
    const { ctx } = fakeContext("tui");
    expect(await modulesCmd(fakeSession().session).execute(ctx, ["list"])).toBe("loaded: a\nnot loaded: b");
  });

  it("throws on an unknown subcommand", () => {
    const { ctx } = fakeContext("tui");
    expect(() => modulesCmd(fakeSession().session).execute(ctx, ["nope"])).toThrow("Unknown subcommand: nope");
  });

  it("stores and saves the selection on Save, and asks for /reload", async () => {
    const { session, notify, appendEntry } = fakeSession();
    const { ctx } = fakeContext("tui", [SPACE, UP, ENTER]); // a off, then Save

    await modulesCmd(session).execute(ctx, []);

    expect(selected(session)).toEqual([]);
    expect(appendEntry).toHaveBeenCalledWith("mypi-modules", { loaded: [] });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("/reload"), "warning");
  });

  it("changes nothing and shows nothing on Escape", async () => {
    const { session, notify, appendEntry } = fakeSession();
    const { ctx } = fakeContext("tui", [SPACE, ESCAPE]);

    expect(await modulesCmd(session).execute(ctx, [])).toBeUndefined();
    expect(selected(session)).toEqual(["a"]);
    expect(notify).not.toHaveBeenCalled();
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
