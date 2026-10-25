import {
  createEventBus,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type RegisteredCommand,
  type SessionStartEvent,
  type ToolCallEvent,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { ToolGuard } from "#core/tool-guard";
import { loadModules } from "#module/index";
import { backgroundRenderer } from "#tool/bash/render";
import mypi from "../index";
import { fakeUI } from "./fakes";

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
  const mcpServers: string[] = [];
  const toolRenderers: unknown[] = [];
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
    registerToolRenderer: (resolver: unknown) => {
      toolRenderers.push(resolver);
    },
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active = names.filter((name) => registered.has(name));
    },
  } as unknown as ExtensionAPI;
  mypi(pi);
  return { pi, commands, handlers, activeTools: () => active, mcpServers, toolRenderers };
}

function fakeContext() {
  return {
    hasUI: true,
    ui: fakeUI(),
    cwd: "/project",
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionCommandContext;
}

/** pi's prompt options as a run starts: empty sections, and the skills and context files it loaded. */
function promptOptions(skills: { baseDir: string }[] = []) {
  return { sections: {}, skills, contextFiles: [] };
}

function startSession(handlers: Map<string, Handler>) {
  const event: SessionStartEvent = { type: "session_start", reason: "startup" };
  handlers.get("session_start")?.(event, fakeContext());
}

const bashCall = {
  type: "tool_call",
  toolCallId: "call-1",
  toolName: "bash",
  input: { command: "ls" },
} as ToolCallEvent;

describe("mypi extension", () => {
  afterEach(() => vi.restoreAllMocks());

  it("registers no commands before a session starts", () => {
    const { commands, handlers } = loadExtension();
    expect(handlers.has("session_start")).toBe(true);
    expect(commands.size).toBe(0);
  });

  it("runs every registered command without throwing", async () => {
    const { commands, handlers } = loadExtension();
    startSession(handlers);
    for (const command of commands.values()) {
      await expect(command.handler("", fakeContext())).resolves.toBeUndefined();
    }
  });

  it("registers commands from running modules only", () => {
    const { pi, commands, handlers } = loadExtension();
    startSession(handlers);

    const session = new Session(fakeContext(), pi);
    loadModules(session, "startup");
    for (const info of session.moduleManager.moduleInfos) {
      for (const command of info.commands) {
        expect(commands.has(command.name)).toBe(info.isLoaded);
      }
    }
  });

  // A module's init() turns its tools on, which pi ignores for tools it doesn't have yet.
  it("registers the tools before the modules' init(), so a new session in Plan has Plan's tools on", () => {
    const { handlers, activeTools } = loadExtension();
    startSession(handlers);
    expect(activeTools()).toEqual(expect.arrayContaining(["web_search", "web_fetch", "submit_plan", "ask_user"]));
  });

  // Each run's sections start empty, so a run that skipped them would make pi remove the section, then add it back.
  it.each([["user"], ["custom"]])("writes the modules' prompt sections on a %s run", (messageType) => {
    const { handlers } = loadExtension();
    startSession(handlers);
    const event = { type: "before_agent_start", messageType, systemPromptOptions: promptOptions() };
    handlers.get("before_agent_start")?.(event, fakeContext());
    expect(Object.keys(event.systemPromptOptions.sections)).toContain("mypi-plan-build");
  });

  // Identity is core: every run says who the agent is, with the model of that run.
  it("writes the identity section on every run, with that run's model and the running modules", () => {
    const { handlers } = loadExtension();
    startSession(handlers);
    const event = { type: "before_agent_start", messageType: "user", systemPromptOptions: promptOptions() };
    const ctx = { ...fakeContext(), model: { provider: "openai", id: "gpt-6.1-sol" } };
    handlers.get("before_agent_start")?.(event, ctx as unknown as ExtensionContext);

    const identity = (event.systemPromptOptions.sections as Record<string, string>)["mypi-identity"];
    expect(identity).toContain("You are MyPi");
    expect(identity).toContain("Model: openai/gpt-6.1-sol. Modules running: plan-build, memory");
  });

  // The folder rule is core: it guards every session, and allows what the prompt points the agent at.
  it("asks before a call reaches outside the folder, except where the last prompt pointed", async () => {
    const { handlers } = loadExtension();
    startSession(handlers);
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

  // pi keeps resolvers in a list, so one added on every session_start would stack.
  it("registers the background bash renderer once, when loaded", () => {
    const { handlers, toolRenderers } = loadExtension();
    startSession(handlers);
    startSession(handlers);
    expect(toolRenderers).toEqual([backgroundRenderer]);
  });

  it("registers MyPi's MCP servers when a session starts", () => {
    const { handlers, mcpServers } = loadExtension();
    expect(mcpServers).toEqual([]);
    startSession(handlers);
    expect(mcpServers).toEqual(["parallel", "exa"]);
  });

  // Pi reads the handler's return value; a handler that awaited the guard without returning would let every call run.
  it("returns the tool guard's result to pi", async () => {
    const blocked = { block: true, reason: "no" };
    vi.spyOn(ToolGuard.prototype, "check").mockResolvedValue(blocked);
    const { handlers } = loadExtension();
    startSession(handlers);
    await expect(handlers.get("tool_call")?.(bashCall, fakeContext())).resolves.toEqual(blocked);
  });
});
