import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Mock, vi } from "vitest";
import { Session } from "#core/session";
import type { Module, ModuleLoadMode } from "#core/types";

/** A custom session entry, the way pi stores what `appendEntry` writes. */
export const customEntry = (customType: string, data: unknown) => ({ type: "custom", customType, data });

/**
 * Pi's `ctx.ui`, with spies for what MyPi calls. `theme.fg` tags text with its color name, like `<warning>plan`, so
 * tests can check the color without ANSI codes.
 */
export function fakeUI() {
  return {
    notify: vi.fn(),
    setStatus: vi.fn<(key: string, text: string | undefined) => void>(),
    setEditorComponent: vi.fn(),
    theme: { fg: (color: string, text: string) => `<${color}>${text}` },
  };
}

/**
 * A `Session` over a fake pi. `branch` stands in for the session's current branch, and `appendEntry` adds to it like
 * pi does, so whatever a test saves can be loaded back.
 */
export function fakeSession(branch: unknown[] = []) {
  const ui = fakeUI();
  const appendEntry = vi.fn((customType: string, data: unknown) => {
    branch.push(customEntry(customType, data));
  });
  const ctx = {
    hasUI: true,
    ui,
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
  const session = new Session(ctx, { appendEntry } as unknown as ExtensionAPI);
  return { session, notify: ui.notify, setStatus: ui.setStatus, appendEntry, branch };
}

/** A module with one command, `<name>-cmd`; `init` is a spy. */
export function fakeModule(name: string, loadType: ModuleLoadMode): Module & { init: Mock<() => void> } {
  return {
    session: {} as Session,
    info: {
      name,
      description: `${name} module`,
      commands: [{ name: `${name}-cmd`, description: `${name} command` }],
      loadType,
    },
    init: vi.fn<() => void>(),
    commands: () => [{ info: { name: `${name}-cmd`, description: `${name} command` }, execute: () => "" }],
  };
}
