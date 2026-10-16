import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { loadModules } from "#module/index";
import mypi from "../index";

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

function loadExtension() {
  const commands = new Map<string, CommandOptions>();
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => {};
    },
    registerCommand: (name: string, options: CommandOptions) => {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;
  mypi(pi);
  return { pi, commands, handlers };
}

function fakeContext() {
  return {
    hasUI: true,
    ui: { notify: vi.fn() },
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionCommandContext;
}

function startSession(handlers: Map<string, Handler>) {
  const event: SessionStartEvent = { type: "session_start", reason: "startup" };
  handlers.get("session_start")?.(event, fakeContext());
}

describe("mypi extension", () => {
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
