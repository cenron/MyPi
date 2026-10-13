import type {
  ExtensionAPI,
  ExtensionCommandContext,
  RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import mypi from "../src/index.ts";

type CommandOptions = Omit<RegisteredCommand, "name" | "sourceInfo">;

function loadCommands() {
  const commands = new Map<string, CommandOptions>();
  const pi = {
    registerCommand: (name: string, options: CommandOptions) => {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;
  mypi(pi);
  return commands;
}

function fakeContext(hasUI: boolean) {
  const notify = vi.fn();
  const ctx = { hasUI, ui: { notify } } as unknown as ExtensionCommandContext;
  return { ctx, notify };
}

describe("mypi extension", () => {
  it("registers the /mypi command", () => {
    expect(loadCommands().has("mypi")).toBe(true);
  });

  it("notifies that MyPi is loaded", async () => {
    const { ctx, notify } = fakeContext(true);
    await loadCommands().get("mypi")?.handler("", ctx);
    expect(notify).toHaveBeenCalledWith("MyPi is loaded.", "info");
  });

  it("stays quiet without a UI", async () => {
    const { ctx, notify } = fakeContext(false);
    await loadCommands().get("mypi")?.handler("", ctx);
    expect(notify).not.toHaveBeenCalled();
  });
});
