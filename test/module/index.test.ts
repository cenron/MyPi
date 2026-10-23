import { describe, expect, it } from "vitest";
import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import { loadModules } from "#module/index";
import { customEntry, fakeSession as fake } from "../fakes";

const fakeSession = (branch: unknown[] = []): Session => fake(branch).session;

/** A branch holding a save that selects every module. */
function everyModuleSaved() {
  const session = fakeSession();
  loadModules(session, "startup");
  return [customEntry("mypi-modules", { loaded: session.moduleManager.moduleInfos.map((m) => m.name) })];
}

// These run the real module list, so they check the rules, not any one module's load mode.
describe("loadModules", () => {
  it("starts every module that isn't ON_DEMAND", () => {
    const session = fakeSession();
    loadModules(session, "startup");
    for (const info of session.moduleManager.moduleInfos) {
      expect(info.isLoaded).toBe(info.loadType !== ModuleLoadMode.ON_DEMAND);
    }
  });

  it("runs a saved selection on reload", () => {
    const session = fakeSession(everyModuleSaved());
    loadModules(session, "reload");
    for (const info of session.moduleManager.moduleInfos) expect(info.isLoaded).toBe(true);
  });
});
