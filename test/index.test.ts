import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { ToolGuard } from "#core/tool-guard";
import { loadModules } from "#module/index";
import mypi from "../index";
import { fakeUI } from "./fakes";

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function loadExtension() {
  const commands = new Map<string, CommandOptions>();
  const handlers = new Map<string, Handler>();
  const pi = {
    // Keeps the entry point's own handler: modules subscribe later, from init(), and would replace it here.
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, handler);
      return () => {};
    },
    registerCommand: (name: string, options: CommandOptions) => {
      commands.set(name, options);
    },
    getAllTools: () => [],
    registerTool: () => {},
    sendUserMessage: () => {},
    getActiveTools: () => [],
    setActiveTools: () => {},
  } as unknown as ExtensionAPI;
  mypi(pi);
  return { pi, commands, handlers };
}

function fakeContext() {
  return {
    hasUI: true,
    ui: fakeUI(),
    cwd: "/project",
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionCommandContext;
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

  it("registers commands when a session starts", () => {
    const { commands, handlers } = loadExtension();
    startSession(handlers);
    expect(commands.size).toBeGreaterThan(0);
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

  // Each run's sections start empty, so a run that skipped them would make pi remove the section, then add it back.
  it.each([["user"], ["custom"]])("writes the modules' prompt sections on a %s run", (messageType) => {
    const { handlers } = loadExtension();
    startSession(handlers);
    const event = { type: "before_agent_start", messageType, systemPromptOptions: { sections: {} } };
    handlers.get("before_agent_start")?.(event, fakeContext());
    expect(Object.keys(event.systemPromptOptions.sections)).toContain("mypi-plan-build");
  });

  it("lets a tool call run when no module objects", async () => {
    const { handlers } = loadExtension();
    startSession(handlers);
    await expect(handlers.get("tool_call")?.(bashCall, fakeContext())).resolves.toBeUndefined();
  });

  // Pi reads the handler's return value; a handler that awaited the guard without returning would let every call run.
  it("returns the tool guard's result to pi", async () => {
    const blocked = { block: true, reason: "no" };
    vi.spyOn(ToolGuard.prototype, "check").mockResolvedValue(blocked);
    const { handlers } = loadExtension();
    startSession(handlers);
    await expect(handlers.get("tool_call")?.(bashCall, fakeContext())).resolves.toEqual(blocked);
  });

  it("handles session shutdown without throwing", () => {
    const { handlers } = loadExtension();
    startSession(handlers);
    const event: SessionShutdownEvent = {
      type: "session_shutdown",
      reason: "quit",
    };
    expect(() => handlers.get("session_shutdown")?.(event, fakeContext())).not.toThrow();
  });
});
