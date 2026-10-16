import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { modulesCmd } from "#command/modules";
import { Session } from "#core/session";
import { type Module, ModuleLoadMode } from "#core/types";

const SPACE = " ";
const ENTER = "\r";
const ESCAPE = "\x1b";
const UP = "\x1b[A";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

type Factory = (
  tui: unknown,
  theme: Theme,
  keybindings: unknown,
  done: (result: unknown) => void,
) => Component;

function fakeModule(name: string): Module {
  return {
    session: {} as Session,
    info: {
      name,
      description: `${name} module`,
      commands: [],
      loadType: ModuleLoadMode.ON_LOAD,
    },
    init: () => {},
    commands: () => [],
  };
}

// Modules a and b; only a is running.
function fakeSession() {
  const notify = vi.fn();
  const ctx = { hasUI: true, ui: { notify } } as unknown as ExtensionContext;
  const session = new Session(ctx, {} as ExtensionAPI);
  session.moduleManager.start(
    [fakeModule("a"), fakeModule("b")],
    new Set(["a"]),
  );
  return { session, notify };
}

// Stands in for pi's ctx.ui.custom: builds the component, then presses the keys.
function fakeContext(mode: string, keys: string[] = []) {
  const custom = vi.fn(
    (factory: Factory, _options?: { overlay?: boolean }) =>
      new Promise((resolve) => {
        const component = factory({}, theme, {}, resolve);
        for (const key of keys) component.handleInput?.(key);
      }),
  );
  const ctx = { mode, ui: { custom } } as unknown as ExtensionCommandContext;
  return { ctx, custom };
}

const selected = (session: Session) =>
  session.moduleManager.moduleInfos
    .filter((m) => m.isSelected)
    .map((m) => m.name);

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("/modules", () => {
  it("lists each module with whether it's running", async () => {
    const { ctx } = fakeContext("tui");
    expect(await modulesCmd(fakeSession().session).execute(ctx, ["list"])).toBe(
      "loaded: a\nnot loaded: b",
    );
  });

  it("throws on an unknown subcommand", () => {
    const { ctx } = fakeContext("tui");
    expect(() =>
      modulesCmd(fakeSession().session).execute(ctx, ["nope"]),
    ).toThrow("Unknown subcommand: nope");
  });

  it("refuses to open the modal outside TUI mode", async () => {
    const { ctx, custom } = fakeContext("print");
    await expect(
      modulesCmd(fakeSession().session).execute(ctx, []),
    ).rejects.toThrow("/modules requires TUI mode");
    expect(custom).not.toHaveBeenCalled();
  });

  it("stores the selection on Save and asks for /reload", async () => {
    const { session, notify } = fakeSession();
    const { ctx } = fakeContext("tui", [SPACE, UP, ENTER]); // a off, then Save

    await modulesCmd(session).execute(ctx, []);

    expect(selected(session)).toEqual([]);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("/reload"),
      "warning",
    );
  });

  // Running modules only change on /reload.
  it("leaves the running modules alone on Save", async () => {
    const { session } = fakeSession();
    const { ctx } = fakeContext("tui", [SPACE, UP, ENTER]);

    await modulesCmd(session).execute(ctx, []);

    expect(
      await modulesCmd(session).execute(fakeContext("tui").ctx, ["list"]),
    ).toBe("loaded: a\nnot loaded: b");
  });

  it("changes nothing and shows nothing on Escape", async () => {
    const { session, notify } = fakeSession();
    const { ctx } = fakeContext("tui", [SPACE, ESCAPE]);

    expect(await modulesCmd(session).execute(ctx, [])).toBeUndefined();
    expect(selected(session)).toEqual(["a"]);
    expect(notify).not.toHaveBeenCalled();
  });
});
