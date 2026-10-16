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

// These run the real module list, so they check the rules, not any one module's load mode.
describe("loadModules", () => {
  it("hands every module to the session's ModuleManager", () => {
    const session = fakeSession();
    loadModules(session, "startup");
    expect(session.moduleManager.moduleInfos.length).toBeGreaterThan(0);
  });

  it.each(["startup", "reload"] as const)(
    "starts every module that isn't ON_DEMAND on %s",
    (reason) => {
      const session = fakeSession();
      loadModules(session, reason);
      for (const info of session.moduleManager.moduleInfos) {
        expect(info.isLoaded).toBe(info.loadType !== ModuleLoadMode.ON_DEMAND);
      }
    },
  );

  it("gives every command a name and description", () => {
    const session = fakeSession();
    loadModules(session, "startup");
    const commands = session.moduleManager.moduleInfos.flatMap(
      (info) => info.commands,
    );
    for (const command of commands) {
      expect(command.name).not.toBe("");
      expect(command.description).not.toBe("");
    }
  });
});
