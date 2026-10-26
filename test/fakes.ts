import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionContext,
  type McpServerConfig,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Mock, vi } from "vitest";
import { Session } from "#core/session";
import type { Module, ModuleLoadMode } from "#core/types";
import type { Project } from "#core/worktree/index";

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
 * pi's defaults, `tools` what was registered, and `mcpServers` the MCP servers registered, by name. Like pi, `setActiveTools` drops names that aren't registered (pi's
 * defaults count as registered). `emit` runs the handlers registered with `pi.on`, with the session's
 * own context unless one is given. `cwd` is the context's working directory.
 */
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
    setActiveTools: vi.fn((names: string[]) => {
      activeTools = names.filter((name) => builtins.includes(name) || tools.has(name));
    }),
  };
  const ctx = {
    hasUI: true,
    cwd,
    isProjectTrusted: () => false,
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
