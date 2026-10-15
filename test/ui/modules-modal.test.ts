import {
  type ExtensionAPI,
  type ExtensionContext,
  initTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { openModulesModal } from "#ui/modules-modal";

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
  session.modules = [
    moduleInfo("a", true),
    moduleInfo("b", false),
    moduleInfo("c", true),
  ];
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

function press(keys: string[]) {
  return openModulesModal(fakeContext(keys).ctx, fakeSession());
}

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("openModulesModal", () => {
  it("refuses to open outside TUI mode", async () => {
    const { ctx, custom } = fakeContext([], "print");
    await expect(openModulesModal(ctx, fakeSession())).rejects.toThrow(
      "/modules requires TUI mode",
    );
    expect(custom).not.toHaveBeenCalled();
  });

  it("opens as an overlay", async () => {
    const { ctx, custom } = fakeContext([ESCAPE]);
    await openModulesModal(ctx, fakeSession());
    expect(custom.mock.calls[0]?.[1]).toMatchObject({ overlay: true });
  });

  it("saves the loaded modules when nothing changed", async () => {
    expect(await press([UP, ENTER])).toEqual(["a", "c"]);
  });

  it("saves the selection in list order, not toggle order", async () => {
    expect(await press([SPACE, SPACE, UP, ENTER])).toEqual(["a", "c"]);
  });

  it("discards the selection on Escape", async () => {
    expect(await press([SPACE, ESCAPE])).toBeUndefined();
  });
});
