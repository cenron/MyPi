import { describe, expect, it, vi } from "vitest";
import type { Session } from "#core/session";
import { PlanBuildModule } from "#module/plan-build/index";
import { BUILD_PROMPT, PLAN_PROMPT } from "#module/plan-build/prompts";
import { customEntry, fakeSession } from "../../fakes";

const saved = (mode: unknown) => customEntry("mypi-module-plan-build", { mode });

/** The module's prompt section, as the next run would send it. */
function promptSection(session: Session) {
  const sections: Record<string, string> = {};
  session.promptManager.apply(sections);
  return sections["mypi-plan-build"];
}

/** A started module and a way to run `/plan <args>`; the command ignores its context. */
function startPlanBuild(branch: unknown[] = []) {
  const fake = fakeSession(branch);
  const module = new PlanBuildModule(fake.session);
  module.init();
  const plan = module.commands().find((command) => command.info.name === "plan");
  if (!plan) throw new Error("no /plan command");
  const run = (...args: string[]) => plan.execute({} as never, args);
  return { ...fake, module, run };
}

describe("PlanBuildModule", () => {
  it("starts in Plan when nothing is saved", () => {
    const { session, setStatus } = fakeSession();
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<warning>PLAN");
  });

  it("restores the saved mode", () => {
    const { session, setStatus } = fakeSession([saved("build")]);
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<dim>BUILD");
  });

  // The session file can hold anything, so a bad value must still leave a mode and a label.
  it.each([["Plan"], [42], [undefined]])("falls back to Plan when the saved mode is %j", (mode) => {
    const { session, setStatus } = fakeSession([saved(mode)]);
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<warning>PLAN");
  });

  // init() runs on every /reload, so saving there would add an entry each time.
  it("doesn't save on init", () => {
    const { session, appendEntry } = fakeSession([saved("build")]);
    new PlanBuildModule(session).init();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("restores the mode /plan saved, as after a /reload", async () => {
    const { session, setStatus, run } = startPlanBuild();
    await run("build");

    new PlanBuildModule(session).init();

    expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<dim>BUILD");
  });

  describe("/plan", () => {
    it("toggles Plan to Build and back with no argument", async () => {
      const { run, setStatus } = startPlanBuild();
      await run();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<dim>BUILD");
      await run();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });

    it.each([
      ["build", "plan", "<dim>BUILD"],
      ["plan", "build", "<warning>PLAN"],
      ["build", "build", "<dim>BUILD"],
    ])("sets %s from %s", async (arg, from, label) => {
      const { run, setStatus, appendEntry } = startPlanBuild([saved(from)]);
      await run(arg);
      expect(appendEntry).toHaveBeenLastCalledWith("mypi-module-plan-build", { mode: arg });
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", label);
    });

    it("throws on an unknown mode and leaves the mode alone", async () => {
      const { run, setStatus, appendEntry } = startPlanBuild();
      await expect(run("foo")).rejects.toThrow("Unknown mode: foo");
      expect(appendEntry).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });

    // Like /modules, only the first argument counts.
    it("ignores arguments after the mode", async () => {
      const { run, setStatus } = startPlanBuild();
      await run("build", "now");
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<dim>BUILD");
    });

    it("shows no message, since the footer shows the change", async () => {
      const { run } = startPlanBuild();
      await expect(run()).resolves.toBeUndefined();
    });
  });

  describe("prompt section", () => {
    it("is the Plan text on init when nothing is saved", () => {
      const { session } = startPlanBuild();
      expect(promptSection(session)).toBe(PLAN_PROMPT);
    });

    // A resumed session or a /reload builds a new, empty PromptManager, so init() must set the text again.
    it("is the Build text on init when Build is saved", () => {
      const { session } = startPlanBuild([saved("build")]);
      expect(promptSection(session)).toBe(BUILD_PROMPT);
    });

    // Leaving Plan replaces the text instead of dropping it, so the model is told the restrictions are gone.
    it("follows each switch, and is never dropped", async () => {
      const { session, run } = startPlanBuild();
      await run("build");
      expect(promptSection(session)).toBe(BUILD_PROMPT);
      await run();
      expect(promptSection(session)).toBe(PLAN_PROMPT);
    });
  });

  describe("Shift+Tab", () => {
    /** Starts the module and returns what it registered for Shift+Tab. */
    function shiftTab() {
      const fake = fakeSession();
      const onKey = vi.spyOn(fake.session.editor, "onKey");
      new PlanBuildModule(fake.session).init();
      const handler = onKey.mock.calls.find(([key]) => key === "shift+tab")?.[1];
      return { ...fake, handler };
    }

    it("is registered on init", () => {
      expect(shiftTab().handler).toBeTypeOf("function");
    });

    // The editor calls the handler on its own, so it must not rely on being called as a method.
    it("toggles the mode when called on its own", async () => {
      const { handler, setStatus, appendEntry } = shiftTab();
      await handler?.();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<dim>BUILD");
      expect(appendEntry).toHaveBeenLastCalledWith("mypi-module-plan-build", { mode: "build" });
      await handler?.();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });
  });
});
