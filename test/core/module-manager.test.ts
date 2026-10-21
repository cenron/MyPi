import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ModuleLoadMode } from "#core/types";
import { customEntry, fakeModule, fakeSession } from "../fakes";

// One module of each load mode, in list order.
function fakeModules() {
  return [
    fakeModule("core", ModuleLoadMode.ALWAYS),
    fakeModule("plan", ModuleLoadMode.ON_LOAD),
    fakeModule("notes", ModuleLoadMode.ON_DEMAND),
  ];
}

/** Starts a manager for `reason` on a branch holding `saved` entries, and returns its running and selected names. */
function start(reason: SessionStartEvent["reason"], ...saved: unknown[]) {
  const { session } = fakeSession(saved.map((data) => customEntry("mypi-modules", data)));
  session.moduleManager.start(fakeModules(), reason);
  const infos = session.moduleManager.moduleInfos;
  return {
    running: infos.filter((m) => m.isLoaded).map((m) => m.name),
    selected: infos.filter((m) => m.isSelected).map((m) => m.name),
  };
}

describe("ModuleManager.start", () => {
  it.each<SessionStartEvent["reason"]>(["startup", "new", "resume", "fork"])(
    "runs the defaults on %s and ignores the saved selection",
    (reason) => {
      expect(start(reason, { loaded: ["notes"] }).running).toEqual(["core", "plan"]);
    },
  );

  it("runs the defaults on reload when nothing was saved", () => {
    expect(start("reload").running).toEqual(["core", "plan"]);
  });

  // An empty saved set means everything was switched off, not that nothing was saved.
  it("runs only ALWAYS modules on reload when the saved selection is empty", () => {
    expect(start("reload", { loaded: [] }).running).toEqual(["core"]);
  });

  it("runs the saved selection on reload, plus every ALWAYS module", () => {
    expect(start("reload", { loaded: ["notes"] }).running).toEqual(["core", "notes"]);
  });

  it("uses the last save on the branch", () => {
    expect(start("reload", { loaded: ["plan"] }, { loaded: ["notes"] }).running).toEqual(["core", "notes"]);
  });

  it("drops saved names that match no module", () => {
    expect(start("reload", { loaded: ["gone", "notes"] }).running).toEqual(["core", "notes"]);
  });

  it("keeps list order, whatever order the save is in", () => {
    expect(start("reload", { loaded: ["notes", "plan", "core"] }).running).toEqual(["core", "plan", "notes"]);
  });

  // The session file can hold anything, so a bad save falls back to the defaults instead of crashing session_start.
  it.each([null, {}, { loaded: "notes" }, "notes"])("runs the defaults on reload when the save is %j", (saved) => {
    expect(start("reload", saved).running).toEqual(["core", "plan"]);
  });

  it("skips saved names that aren't strings", () => {
    expect(start("reload", { loaded: ["notes", 3] }).running).toEqual(["core", "notes"]);
  });

  it("starts with the running modules selected", () => {
    expect(start("reload", { loaded: ["notes"] }).selected).toEqual(["core", "notes"]);
  });

  // MyPi registers the modules' tools in between, so init() can turn them on.
  it("doesn't run init() itself", () => {
    const { session } = fakeSession();
    const modules = fakeModules();
    session.moduleManager.start(modules, "startup");
    expect(modules.map((m) => m.init.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it("runs init() on the running modules only, once init() is called", () => {
    const { session } = fakeSession();
    const modules = fakeModules();
    session.moduleManager.start(modules, "startup");
    session.moduleManager.init();
    expect(modules.map((m) => m.init.mock.calls.length)).toEqual([1, 1, 0]);
  });

  it("returns commands from running modules only", () => {
    const { session } = fakeSession();
    session.moduleManager.start(fakeModules(), "startup");
    expect(session.moduleManager.getCommands().map((c) => c.info.name)).toEqual(["core-cmd", "plan-cmd"]);
  });

  it("returns tools from running modules only", () => {
    const { session } = fakeSession();
    session.moduleManager.start(fakeModules(), "startup");
    expect(session.moduleManager.getTools().map((t) => t.name)).toEqual(["core-tool", "plan-tool"]);
  });
});

describe("ModuleManager.select", () => {
  function started() {
    const fake = fakeSession();
    fake.session.moduleManager.start(fakeModules(), "startup");
    return fake;
  }

  it("adds every ALWAYS module and returns the selection in list order", () => {
    expect(started().session.moduleManager.select(new Set(["notes"]))).toEqual(["core", "notes"]);
  });

  // pi writes entries with JSON.stringify, which would save a Set as {}.
  it("saves the selection as a mypi-modules entry holding an array", () => {
    const { session, appendEntry } = started();
    session.moduleManager.select(new Set(["notes"]));
    expect(appendEntry).toHaveBeenCalledWith("mypi-modules", { loaded: ["core", "notes"] });
  });

  // Running modules change only on /reload.
  it("changes the selection but not what's running", () => {
    const { session } = started();
    session.moduleManager.select(new Set(["notes"]));

    expect(session.moduleManager.moduleInfos.map((m) => [m.name, m.isLoaded, m.isSelected])).toEqual([
      ["core", true, true],
      ["plan", true, false],
      ["notes", false, true],
    ]);
    expect(session.moduleManager.getCommands().map((c) => c.info.name)).toEqual(["core-cmd", "plan-cmd"]);
  });

  it("is what the next reload runs", () => {
    const { session, branch } = started();
    session.moduleManager.select(new Set(["notes"]));

    const reloaded = fakeSession(branch).session;
    reloaded.moduleManager.start(fakeModules(), "reload");
    expect(reloaded.moduleManager.moduleInfos.filter((m) => m.isLoaded).map((m) => m.name)).toEqual(["core", "notes"]);
  });
});
