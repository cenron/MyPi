import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
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

  // A module's info getter can return a new object on every read, so the flag must live on the session's copy.
  it("marks every module that isn't ON_DEMAND as loaded in session.modules", () => {
    const session = fakeSession();
    const modules = loadModules(session);

    expect(session.modules.map((m) => m.name)).toEqual(
      modules.map((m) => m.info.name),
    );
    for (const info of session.modules) {
      expect(info.isLoaded).toBe(info.loadType !== ModuleLoadMode.ON_DEMAND);
    }
  });

  it("loads plan-build", () => {
    const session = fakeSession();
    loadModules(session);
    expect(session.modules.find((m) => m.name === "plan-build")?.isLoaded).toBe(
      true,
    );
  });

  it("gives every command a name and description", () => {
    const commands = loadModules(fakeSession()).flatMap((module) =>
      module.commands(),
    );
    for (const command of commands) {
      expect(command.info.name).not.toBe("");
      expect(command.info.description).not.toBe("");
    }
  });
});
