import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { loadModules } from "#module/index";

function fakeSession() {
  const ctx = {
    hasUI: true,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionContext;
  return new Session(ctx, {} as ExtensionAPI);
}

describe("loadModules", () => {
  it("builds every module with the session", () => {
    const session = fakeSession();
    const modules = loadModules(session);
    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) expect(module.session).toBe(session);
  });

  it("gives every command a name and description", () => {
    const commands = loadModules(fakeSession()).flatMap((module) =>
      module.commands(),
    );
    for (const command of commands) {
      expect(command.name).not.toBe("");
      expect(command.description).not.toBe("");
    }
  });
});
