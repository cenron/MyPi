import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
  type McpServerConfig,
  type Theme,
  type ToolDefinition,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { type Mock, vi } from "vitest";
import { Session } from "#core/session";
import type { Module, ModuleLoadMode } from "#core/types";
import type { Project } from "#core/worktree/index";

/** Pi-like renderer fakes for tests that delegate to the next tool renderer. */
export function fakeToolRenderers() {
  return {
    renderCall: vi.fn(() => new Text("pi call", 0, 0)),
    renderResult: vi.fn(() => new Text("pi result", 0, 0)),
  } as unknown as ToolRenderers & { renderCall: ReturnType<typeof vi.fn>; renderResult: ReturnType<typeof vi.fn> };
}

/** Key codes a test presses in a dialog. */
export const KEY = { SPACE: " ", ENTER: "\r", ESCAPE: "\x1b", UP: "\x1b[A", DOWN: "\x1b[B" } as const;

/** A theme that leaves text as it is, for tests that read a dialog's plain text. */
export const plainTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

type DialogFactory = (tui: unknown, theme: Theme, keybindings: unknown, done: (result: unknown) => void) => Component;

/** Stands in for pi's `ctx.ui.custom`: builds the component with `plainTheme`, then presses `keys`. */
export function customPressing(keys: readonly string[] = []) {
  return vi.fn(
    (factory: DialogFactory, _options?: unknown) =>
      new Promise<unknown>((resolve) => {
        const component = factory({ requestRender: vi.fn() }, plainTheme, {}, resolve);
        for (const key of keys) component.handleInput?.(key);
      }),
  );
}

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
    setWidget: vi.fn(),
    setWorkingMessage: vi.fn(),
    select: vi.fn(
      async (_title: string, _options: string[], _opts?: unknown): Promise<string | undefined> => undefined,
    ),
    theme: {
      fg: (color: string, text: string) => `<${color}>${text}`,
      strikethrough: (text: string) => `<strike>${text}`,
    },
  };
}

/**
 * A `Session` over a fake pi. `branch` stands in for the session's current branch, and `appendEntry` adds to it like
 * pi does, so whatever a test saves can be loaded back. `activeTools` holds the active tool names, starting with
 * pi's defaults, `tools` what was registered, and `mcpServers` the MCP servers registered, by name. Like pi, `setActiveTools` drops names that aren't registered (pi's
 * defaults count as registered). `emit` runs the handlers registered with `pi.on`, with the session's
 * own context unless one is given. `cwd` is the context's working directory.
 */
export function fakeSessionWithModules(modules: Module[]) {
  const fake = fakeSession();
  fake.session.moduleManager.start(modules, "startup");
  return fake;
}

export function fakeSession(branch: unknown[] = [], cwd = "/project", project?: Project) {
  const ui = fakeUI();
  const appendEntry = vi.fn((customType: string, data: unknown) => {
    branch.push(customEntry(customType, data));
  });
  const builtins = ["read", "bash", "edit", "write"];
  let activeTools = [...builtins];
  const tools = new Map<string, ToolDefinition>();
  const mcpServers = new Map<string, McpServerConfig>();
  const handlers = new Map<string, ((ev: unknown, ctx: ExtensionContext) => unknown)[]>();
  const pi = {
    on: (event: string, handler: (ev: unknown, ctx: ExtensionContext) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
    // pi's own bus, so MyPi's publish, subscribe, ask, and answer run as they do in pi.
    events: createEventBus(),
    sendUserMessage: vi.fn(),
    sendMessage: vi.fn(),
    registerMessageRenderer: vi.fn(),
    appendEntry,
    getAllTools: () => [],
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerMcpServer: vi.fn((name: string, config: McpServerConfig) => {
      mcpServers.set(name, config);
    }),
    getActiveTools: () => [...activeTools],
    getThinkingLevel: vi.fn(() => "high" as const),
    setThinkingLevel: vi.fn(),
    setModel: vi.fn(async () => true),
    setActiveTools: vi.fn((names: string[]) => {
      activeTools = names.filter((name) => builtins.includes(name) || tools.has(name));
    }),
  };
  const ctx = {
    hasUI: true,
    cwd,
    isProjectTrusted: () => false,
    modelRegistry: { find: vi.fn((provider: string, id: string) => ({ provider, id })) },
    ui,
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
  /** Runs every handler of `event` in order, as pi does; returns the last one's result, for events that take one. */
  const emit = async (event: string, ev: unknown, eventCtx: ExtensionContext = ctx) => {
    let result: unknown;
    for (const handler of handlers.get(event) ?? []) result = await handler(ev, eventCtx);
    return result;
  };
  const session = new Session(ctx, pi as unknown as ExtensionAPI, project);
  return {
    session,
    notify: ui.notify,
    setStatus: ui.setStatus,
    appendEntry,
    branch,
    tools,
    mcpServers,
    registerMcpServer: pi.registerMcpServer,
    setActiveTools: pi.setActiveTools,
    activeTools: () => activeTools,
    sendUserMessage: pi.sendUserMessage,
    sendMessage: pi.sendMessage,
    registerMessageRenderer: pi.registerMessageRenderer,
    select: ui.select,
    emit,
  };
}

/** A module with one command, `<name>-cmd`, and one tool, `<name>-tool`; `init` is a spy. */
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
    tools: () => [{ name: `${name}-tool` } as ToolDefinition],
  };
}
