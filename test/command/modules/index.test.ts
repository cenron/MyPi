import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { modulesCmd } from "#command/modules/index";
import { Session } from "#core/session";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";

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

function moduleInfo(name: string, isLoaded: boolean): ModuleInfo {
  return {
    name,
    description: `${name} module`,
    commands: [],
    loadType: ModuleLoadMode.ON_LOAD,
    isLoaded,
  };
}

function fakeSession() {
  const ctx = {
    hasUI: true,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
  const session = new Session(ctx, {} as ExtensionAPI);
  session.modules = [moduleInfo("a", true), moduleInfo("b", false)];
  return session;
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

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("/modules", () => {
  it("prints the module names with list", async () => {
    const { ctx } = fakeContext("tui");
    expect(await modulesCmd(fakeSession()).execute(ctx, ["list"])).toBe("a\nb");
  });

  it("throws on an unknown subcommand", () => {
    const { ctx } = fakeContext("tui");
    expect(() => modulesCmd(fakeSession()).execute(ctx, ["nope"])).toThrow(
      "Unknown subcommand: nope",
    );
  });

  it("refuses to open the modal outside TUI mode", async () => {
    const { ctx, custom } = fakeContext("print");
    await expect(modulesCmd(fakeSession()).execute(ctx, [])).rejects.toThrow(
      "/modules requires TUI mode",
    );
    expect(custom).not.toHaveBeenCalled();
  });

  it("reports the saved selection", async () => {
    const { ctx } = fakeContext("tui", [UP, ENTER]);
    expect(await modulesCmd(fakeSession()).execute(ctx, [])).toBe(
      "Selected: a",
    );
  });

  it("reports none when everything is switched off", async () => {
    const { ctx } = fakeContext("tui", [SPACE, UP, ENTER]);
    expect(await modulesCmd(fakeSession()).execute(ctx, [])).toBe(
      "Selected: none",
    );
  });

  it("shows nothing on Escape", async () => {
    const { ctx } = fakeContext("tui", [SPACE, ESCAPE]);
    expect(await modulesCmd(fakeSession()).execute(ctx, [])).toBeUndefined();
  });
});
