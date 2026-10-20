import { describe, expect, it } from "vitest";
import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import { BaseModule } from "#module/base";
import { FooterColor, type FooterItem } from "#ui/footer";
import { customEntry, fakeSession } from "../fakes";

/** A module with a counter as its state; `save` and `load` expose the protected state methods. */
class Counter extends BaseModule<{ count: number }> {
  constructor(
    session: Session,
    private readonly name = "counter",
  ) {
    super(session);
  }

  get info() {
    return { name: this.name, description: "", commands: [], loadType: ModuleLoadMode.ON_LOAD };
  }

  save(count: number) {
    this.saveState({ count });
  }

  load() {
    return this.loadState();
  }

  footer(item: FooterItem | undefined) {
    this.setFooter(item);
  }

  prompt(text: string | undefined) {
    this.setPrompt(text);
  }
}

describe("BaseModule", () => {
  it("gives a module no-op init() and no commands by default", () => {
    const module = new Counter(fakeSession().session);
    expect(() => module.init()).not.toThrow();
    expect(module.commands()).toEqual([]);
  });

  it("saves the module's state as mypi-module-<name>", () => {
    const { session, appendEntry } = fakeSession();
    new Counter(session).save(1);
    expect(appendEntry).toHaveBeenCalledWith("mypi-module-counter", { count: 1 });
  });

  it("loads the module's last saved state", () => {
    const { session } = fakeSession();
    const module = new Counter(session);
    module.save(1);
    module.save(2);
    expect(module.load()).toEqual({ count: 2 });
  });

  it("loads undefined when the module saved nothing", () => {
    expect(new Counter(fakeSession().session).load()).toBeUndefined();
  });

  // The prefix keeps a module's state apart from other modules' and from core's own entries.
  it("doesn't see another module's state, or core's mypi-modules", () => {
    const { session } = fakeSession([customEntry("mypi-modules", { count: 9 })]);
    new Counter(session, "other").save(5);
    expect(new Counter(session).load()).toBeUndefined();
  });

  // A module named "modules" saves as mypi-module-modules, so it can't overwrite the module selection.
  it("can't collide with core even when a module is named modules", () => {
    const { session, appendEntry } = fakeSession();
    new Counter(session, "modules").save(1);
    expect(appendEntry).toHaveBeenCalledWith("mypi-module-modules", { count: 1 });
    expect(session.load("modules")).toBeUndefined();
  });

  it("gives each module one footer slot, keyed by its name", () => {
    const { session, setStatus } = fakeSession();
    new Counter(session).footer({ text: "1", color: FooterColor.Accent });
    new Counter(session, "other").footer({ text: "2", color: FooterColor.Dim });
    new Counter(session).footer(undefined);
    expect(setStatus.mock.calls).toEqual([
      ["mypi-counter", "<accent>1"],
      ["mypi-other", "<dim>2"],
      ["mypi-counter", undefined],
    ]);
  });

  it("gives each module one prompt section, keyed by its name", () => {
    const { session } = fakeSession();
    new Counter(session).prompt("one");
    new Counter(session, "other").prompt("two");
    new Counter(session).prompt("three");
    new Counter(session, "other").prompt(undefined);
    const sections: Record<string, string> = {};
    session.promptManager.apply(sections);
    expect(sections).toEqual({ "mypi-counter": "three" });
  });
});
