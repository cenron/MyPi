import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerCommands } from "#command/index";
import { ModuleLoadMode } from "#core/types";
import { fakeModule, fakeSession } from "../fakes";

function failingCommand() {
  const { session, notify } = fakeSession();
  const failure = new Error("replacement failed");
  const module = fakeModule("failure", ModuleLoadMode.ON_LOAD);
  module.commands = () => [
    {
      info: { name: "failure", description: "test" },
      execute: () => {
        throw failure;
      },
    },
  ];
  session.moduleManager.start([module], "startup");
  const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  const pi = {
    registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) =>
      commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerCommands(pi, session);
  const command = commands.get("failure");
  if (!command) throw new Error("test command not registered");
  return { session, notify, failure, command };
}

describe("command error boundary", () => {
  it("notifies ordinary errors through the session", async () => {
    const { notify, command } = failingCommand();
    await command.handler("", {} as ExtensionCommandContext);
    expect(notify).toHaveBeenCalledWith("replacement failed", "error");
  });

  it("rethrows the original error if replacement invalidated its notifier", async () => {
    const { session, failure, command } = failingCommand();
    vi.spyOn(session, "logError").mockImplementation(() => {
      throw new Error("stale context");
    });
    await expect(command.handler("", {} as ExtensionCommandContext)).rejects.toBe(failure);
  });
});
