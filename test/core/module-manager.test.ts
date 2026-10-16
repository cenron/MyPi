import type { SessionStartEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, type Mock, vi } from "vitest";
import { ModuleManager, pickLoaded } from "#core/module-manager";
import type { Session } from "#core/session";
import { type Module, ModuleLoadMode } from "#core/types";

// One module of each load mode, in list order.
const infos = [
  { name: "core", loadType: ModuleLoadMode.ALWAYS },
  { name: "plan", loadType: ModuleLoadMode.ON_LOAD },
  { name: "notes", loadType: ModuleLoadMode.ON_DEMAND },
];

function fakeModule(
  name: string,
  loadType: ModuleLoadMode,
): Module & { init: Mock<() => void> } {
  return {
    session: {} as Session,
    info: { name, description: `${name} module`, commands: [], loadType },
    init: vi.fn<() => void>(),
    commands: () => [
      {
        info: { name: `${name}-cmd`, description: `${name} command` },
        execute: () => "",
      },
    ],
  };
}

function fakeModules() {
  return infos.map((info) => fakeModule(info.name, info.loadType));
}

const names = (set: Set<string>) => [...set];

describe("pickLoaded", () => {
  it.each<SessionStartEvent["reason"]>(["startup", "new", "resume", "fork"])(
    "loads the defaults on %s and ignores the saved set",
    (reason) => {
      expect(names(pickLoaded(reason, new Set(["notes"]), infos))).toEqual([
        "core",
        "plan",
      ]);
    },
  );

  it("loads the defaults on reload when nothing was saved", () => {
    expect(names(pickLoaded("reload", undefined, infos))).toEqual([
      "core",
      "plan",
    ]);
  });

  // An empty saved set means everything was switched off, not that nothing was saved.
  it("loads only ALWAYS modules on reload when the saved set is empty", () => {
    expect(names(pickLoaded("reload", new Set(), infos))).toEqual(["core"]);
  });

  it("loads the saved set on reload, plus every ALWAYS module", () => {
    expect(names(pickLoaded("reload", new Set(["notes"]), infos))).toEqual([
      "core",
      "notes",
    ]);
  });

  it("drops saved names that match no module", () => {
    expect(
      names(pickLoaded("reload", new Set(["gone", "notes"]), infos)),
    ).toEqual(["core", "notes"]);
  });

  it("keeps list order, whatever order the saved set is in", () => {
    expect(
      names(pickLoaded("reload", new Set(["notes", "plan", "core"]), infos)),
    ).toEqual(["core", "plan", "notes"]);
  });
});

describe("ModuleManager", () => {
  it("runs init() only on the modules it starts", () => {
    const modules = fakeModules();
    new ModuleManager().start(modules, new Set(["core", "plan"]));
    expect(modules.map((m) => m.init.mock.calls.length)).toEqual([1, 1, 0]);
  });

  it("returns commands from running modules only", () => {
    const manager = new ModuleManager();
    manager.start(fakeModules(), new Set(["core", "plan"]));
    expect(manager.getCommands().map((c) => c.info.name)).toEqual([
      "core-cmd",
      "plan-cmd",
    ]);
  });

  it("starts with the running set selected", () => {
    const manager = new ModuleManager();
    manager.start(fakeModules(), new Set(["core", "plan"]));
    expect(
      manager.moduleInfos.map((m) => [m.name, m.isLoaded, m.isSelected]),
    ).toEqual([
      ["core", true, true],
      ["plan", true, true],
      ["notes", false, false],
    ]);
  });

  it("adds every ALWAYS module to a selection and returns it in list order", () => {
    const manager = new ModuleManager();
    manager.start(fakeModules(), new Set(["core", "plan"]));
    expect(manager.select(new Set(["notes"]))).toEqual(["core", "notes"]);
  });

  // Running modules change only on /reload, so select() must not touch them.
  it("changes the selection but not what's running", () => {
    const manager = new ModuleManager();
    manager.start(fakeModules(), new Set(["core", "plan"]));
    manager.select(new Set(["notes"]));

    expect(
      manager.moduleInfos.map((m) => [m.name, m.isLoaded, m.isSelected]),
    ).toEqual([
      ["core", true, true],
      ["plan", true, false],
      ["notes", false, true],
    ]);
    expect(manager.getCommands().map((c) => c.info.name)).toEqual([
      "core-cmd",
      "plan-cmd",
    ]);
  });
});
