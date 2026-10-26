import { type ExtensionContext, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { openToggleDialog } from "#ui/components/toggle-dialog";

const SPACE = " ";
const ENTER = "\r";
const DOWN = "\x1b[B";
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;
type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: (result: unknown) => void) => Component;

function context(keys: string[]) {
  const custom = vi.fn(
    (factory: Factory, _options?: unknown) =>
      new Promise((resolve) => {
        const component = factory({}, theme, {}, resolve);
        for (const key of keys) component.handleInput?.(key);
      }),
  );
  return { ctx: { ui: { custom } } as unknown as ExtensionContext, custom };
}

beforeAll(() => initTheme("dark"));

describe("openToggleDialog", () => {
  it("returns only enabled ids on Save and cancels on Escape", async () => {
    const items = [
      { id: "a", label: "A", on: true },
      { id: "b", label: "B", on: false },
    ];
    const save = context([SPACE, DOWN, SPACE, DOWN, ENTER]);
    expect(await openToggleDialog(save.ctx, "Options", items)).toEqual(new Set(["b"]));
    expect(save.custom.mock.calls[0]?.[1]).toEqual({
      overlay: true,
      overlayOptions: { anchor: "center", width: 100, maxHeight: "70%" },
    });

    expect(await openToggleDialog(context(["\x1b"]).ctx, "Options", items)).toBeUndefined();
  });
});
