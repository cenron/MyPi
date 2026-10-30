import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type RegisteredCommand,
  type SessionStartEvent,
  type ToolCallEvent,
  type ToolDefinition,
  type ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { MYPI_SESSION_MARKER_TYPE } from "#core/session-marker";
import { ToolGuard } from "#core/tool-guard";
import { Worktrees } from "#core/worktree/index";
import { loadModules } from "#module/index";
import { backgroundRenderer } from "#tool/bash/render";
import mypi from "../index";
import { fakeToolRenderers, fakeUI } from "./fakes";

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

/**
 * Loads the extension into a fake pi. Like pi, a registered tool is active unless `defaultActive: false`, and
 * `setActiveTools` drops names that aren't registered; `activeTools` reads the active set, and `mcpServers` the
 * names of the MCP servers registered.
 */
function loadExtension() {
  const commands = new Map<string, CommandOptions>();
  const handlers = new Map<string, Handler>();
  const registered = new Set(["read", "bash", "edit", "write"]);
  const branch: unknown[] = [];
  const appendEntry = vi.fn((customType: string, data: unknown) => {
    branch.push({ type: "custom", customType, data });
  });
  const mcpServers: string[] = [];
  const toolRenderers: ToolRendererResolver[] = [];
  let active = [...registered];
  const pi = {
    events: createEventBus(),
    // Keeps the entry point's own handler: modules subscribe later, from init(), and would replace it here.
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, handler);
      return () => {};
    },
    registerCommand: (name: string, options: CommandOptions) => {
      commands.set(name, options);
    },
    getAllTools: () => [],
    registerTool: (tool: ToolDefinition) => {
      registered.add(tool.name);
      if (tool.defaultActive !== false) active.push(tool.name);
    },
    registerMcpServer: (name: string) => {
      mcpServers.push(name);
    },
    sendUserMessage: () => {},
    registerMessageRenderer: () => {},
    appendEntry,
    registerToolRenderer: (resolver: ToolRendererResolver) => {
      toolRenderers.push(resolver);
    },
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = names.filter((name) => registered.has(name));
    },
  } as unknown as ExtensionAPI;
  mypi(pi);
  return { pi, commands, handlers, activeTools: () => active, mcpServers, toolRenderers, appendEntry, branch };
}

function fakeContext() {
  return {
    hasUI: true,
    ui: fakeUI(),
    cwd: "/project",
    isProjectTrusted: () => false,
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionCommandContext;
}

/** pi's prompt options as a run starts: empty sections, and the skills and context files it loaded. */
function promptOptions(skills: { baseDir: string }[] = []) {
  return { sections: {}, skills, contextFiles: [] };
}

function startSession(handlers: Map<string, Handler>) {
  const event: SessionStartEvent = { type: "session_start", reason: "startup" };
  return handlers.get("session_start")?.(event, fakeContext());
}

const bashCall = {
  type: "tool_call",
  toolCallId: "call-1",
  toolName: "bash",
  input: { command: "ls" },
} as ToolCallEvent;

describe("mypi extension", () => {
  beforeEach(() => {
    vi.spyOn(Worktrees.prototype, "project").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("awaits project discovery before loading modules and registering commands", async () => {
    let finish: (() => void) | undefined;
    vi.spyOn(Worktrees.prototype, "project").mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return undefined;
    });
    const { commands, handlers } = loadExtension();
    const starting = startSession(handlers);
    expect(commands.size).toBe(0);
    finish?.();
    await starting;
    expect(commands.has("worktree")).toBe(true);
    expect(Worktrees.prototype.project).toHaveBeenCalledOnce();
  });

  it("warns once on discovery failure and loads without a project, with the core folder guard on", async () => {
    vi.spyOn(Worktrees.prototype, "project").mockRejectedValue(new Error("Git discovery failed"));
    const { commands, handlers } = loadExtension();
    const ctx = fakeContext();
    await expect(
      handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx),
    ).resolves.toBeUndefined();
    expect(
      vi
        .mocked(ctx.ui.notify)
        .mock.calls.filter(([message]) => message.includes("Project discovery failed: Git discovery failed")),
    ).toHaveLength(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Project discovery failed: Git discovery failed"),
      "warning",
    );
    expect(commands.has("worktree")).toBe(true);
    expect(commands.has("plan")).toBe(true);
    ctx.hasUI = false;
    const read = { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "/outside/file" } };
    await expect(handlers.get("tool_call")?.(read, ctx)).resolves.toMatchObject({ block: true });
  });

  it("marks a MyPi session once across repeated session starts", async () => {
    const { handlers, appendEntry, branch } = loadExtension();
    const ctx = { ...fakeContext(), sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext;
    await handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx);
    await handlers.get("session_start")?.({ type: "session_start", reason: "resume" }, ctx);
    expect(appendEntry).toHaveBeenCalledOnce();
    expect(appendEntry).toHaveBeenCalledWith(MYPI_SESSION_MARKER_TYPE, {});
    expect(branch).toContainEqual({ type: "custom", customType: MYPI_SESSION_MARKER_TYPE, data: {} });
  });

  it("registers no commands before a session starts", () => {
    const { commands, handlers } = loadExtension();
    expect(handlers.has("session_start")).toBe(true);
    expect(commands.size).toBe(0);
  });

  it("runs every registered command without throwing", async () => {
    const { commands, handlers } = loadExtension();
    await startSession(handlers);
    for (const command of commands.values()) {
      await expect(command.handler("", fakeContext())).resolves.toBeUndefined();
    }
  });

  it("registers commands from running modules only", async () => {
    const { pi, commands, handlers } = loadExtension();
    await startSession(handlers);

    const session = new Session(fakeContext(), pi, undefined);
    loadModules(session, "startup");
    for (const info of session.moduleManager.moduleInfos) {
      for (const command of info.commands) {
        expect(commands.has(command.name)).toBe(info.isLoaded);
      }
    }
  });

  // A module's init() turns its tools on, which pi ignores for tools it doesn't have yet.
  it("registers the tools before the modules' init(), so a new session in Plan has Plan's tools on", async () => {
    const { handlers, activeTools } = loadExtension();
    await startSession(handlers);
    expect(activeTools()).toEqual(expect.arrayContaining(["web_search", "web_fetch", "submit_plan", "ask_user"]));
  });

  // Each run's sections start empty, so a run that skipped them would make pi remove the section, then add it back.
  it.each([["user"], ["custom"]])("writes the modules' prompt sections on a %s run", async (messageType) => {
    const { handlers } = loadExtension();
    await startSession(handlers);
    const event = { type: "before_agent_start", messageType, systemPromptOptions: promptOptions() };
    handlers.get("before_agent_start")?.(event, fakeContext());
    expect(Object.keys(event.systemPromptOptions.sections)).toContain("mypi-plan-build");
  });

  // Identity is core: every run says who the agent is, with the model of that run.
  it("writes the identity section on every run, with that run's model and the running modules", async () => {
    const { handlers } = loadExtension();
    await startSession(handlers);
    const event = { type: "before_agent_start", messageType: "user", systemPromptOptions: promptOptions() };
    const ctx = { ...fakeContext(), model: { provider: "openai", id: "gpt-6.1-sol" } };
    handlers.get("before_agent_start")?.(event, ctx as unknown as ExtensionContext);

    const identity = (event.systemPromptOptions.sections as Record<string, string>)["mypi-identity"];
    expect(identity).toContain("You are MyPi");
    expect(identity).toContain("Model: openai/gpt-6.1-sol. Modules running: plan-build, quiet, analytics, memory");
  });

  // The folder rule is core: it guards every session, and allows what the prompt points the agent at.
  it("asks before a call reaches outside the folder, except where the last prompt pointed", async () => {
    const { handlers } = loadExtension();
    await startSession(handlers);
    const ctx = { ...fakeContext(), hasUI: false };
    const read = { type: "tool_call", toolCallId: "1", toolName: "read", input: { path: "/skills/herdr/SKILL.md" } };
    await expect(handlers.get("tool_call")?.(read, ctx)).resolves.toMatchObject({
      reason: expect.stringContaining("folder-guard: Reaches outside /project: /skills/herdr/SKILL.md"),
    });

    const options = promptOptions([{ baseDir: "/skills/herdr" }]);
    handlers.get("before_agent_start")?.(
      { type: "before_agent_start", messageType: "user", systemPromptOptions: options },
      ctx,
    );
    await expect(handlers.get("tool_call")?.(read, ctx)).resolves.toBeUndefined();
  });

  // A reload redraws the transcript before session_start, so the resolver runs with no session yet.
  it("draws a reload's redrawn rows with pi's renderers, before a session starts", async () => {
    const { handlers, toolRenderers } = loadExtension();
    const delegate = toolRenderers[1];
    if (!delegate) throw new Error("MyPi registered only one tool renderer");
    const piRenderers = fakeToolRenderers();
    const next = vi.fn(() => piRenderers);
    expect(delegate("bash", next)).toBe(piRenderers);
    await startSession(handlers);
    // With a session the modules' chain answers; quiet is off at startup, so pi's renderers still come back.
    expect(delegate("bash", next)).toBe(piRenderers);
  });

  it("registers each renderer once across sessions", async () => {
    const { handlers, toolRenderers } = loadExtension();
    await startSession(handlers);
    await startSession(handlers);
    expect(toolRenderers).toEqual([backgroundRenderer, expect.any(Function)]);
  });

  it("registers MyPi's MCP servers when a session starts", async () => {
    const { handlers, mcpServers } = loadExtension();
    expect(mcpServers).toEqual([]);
    await startSession(handlers);
    expect(mcpServers).toEqual(["parallel", "exa", "tinyfish"]);
  });

  // Pi reads the handler's return value; a handler that awaited the guard without returning would let every call run.
  it("returns the tool guard's result to pi", async () => {
    const blocked = { block: true, reason: "no" };
    vi.spyOn(ToolGuard.prototype, "check").mockResolvedValue(blocked);
    const { handlers } = loadExtension();
    await startSession(handlers);
    await expect(handlers.get("tool_call")?.(bashCall, fakeContext())).resolves.toEqual(blocked);
  });
});
