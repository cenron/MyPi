import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
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
    select: vi.fn(
      async (_title: string, _options: string[], _opts?: unknown): Promise<string | undefined> => undefined,
    ),
    theme: { fg: (color: string, text: string) => `<${color}>${text}` },
  };
}

/**
 * A `Session` over a fake pi. `branch` stands in for the session's current branch, and `appendEntry` adds to it like
 * pi does, so whatever a test saves can be loaded back. `activeTools` holds the active tool names, starting with
 * pi's defaults, and `tools` what was registered. `emit` runs the handlers registered with `pi.on`, with the session's
 * own context unless one is given.
 */
export function fakeSession(branch: unknown[] = []) {
  const ui = fakeUI();
  const appendEntry = vi.fn((customType: string, data: unknown) => {
    branch.push(customEntry(customType, data));
  });
  let activeTools = ["read", "bash", "edit", "write"];
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, ((ev: unknown, ctx: ExtensionContext) => unknown)[]>();
  const pi = {
    on: (event: string, handler: (ev: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    sendUserMessage: vi.fn(),
    appendEntry,
    getAllTools: () => [],
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    getActiveTools: () => [...activeTools],
    setActiveTools: vi.fn((names: string[]) => {
      activeTools = [...names];
    }),
  };
  const ctx = {
    hasUI: true,
    cwd: "/project",
    ui,
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
  const emit = async (event: string, ev: unknown, eventCtx: ExtensionContext = ctx) => {
    for (const handler of handlers.get(event) ?? []) await handler(ev, eventCtx);
  };
  const session = new Session(ctx, pi as unknown as ExtensionAPI);
  return {
    session,
    notify: ui.notify,
    setStatus: ui.setStatus,
    appendEntry,
    branch,
    tools,
    setActiveTools: pi.setActiveTools,
    activeTools: () => activeTools,
    sendUserMessage: pi.sendUserMessage,
    select: ui.select,
    emit,
  };
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
