import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext, ToolCallEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ask } from "#core/events";
import type { Session } from "#core/session";
import { PlanBuildModule } from "#module/plan-build/index";
import { buildPrompt, PLAN_PROMPT } from "#module/plan-build/prompts";
import { customEntry, fakeSession } from "../../fakes";

const saved = (mode: unknown, plan?: string, thinking?: unknown) =>
  customEntry("mypi-module-plan-build", { mode, ...(plan ? { plan } : {}), ...(thinking ? { thinking } : {}) });

/** The module's prompt section, as the next run would send it. */
function promptSection(session: Session) {
  const sections: Record<string, string> = {};
  session.promptManager.apply(sections);
  return sections["mypi-plan-build"];
}

/** A started module and a way to run `/plan <args>`; the command ignores its context. */
function startPlanBuild(branch: unknown[] = [], cwd = "/project", main?: string) {
  const fake = fakeSession(branch, cwd, main ? { main, commonDir: join(main, ".git") } : undefined);
  const module = new PlanBuildModule(fake.session);
  for (const tool of module.tools()) fake.session.pi.registerTool(tool);
  module.init();
  const plan = module.commands().find((command) => command.info.name === "plan");
  if (!plan) throw new Error("no /plan command");
  const run = (...args: string[]) => plan.execute({} as never, args);
  return { ...fake, module, run };
}

describe("PlanBuildModule", () => {
  it("Plan prompt requires complete hand-offs and checking existing APIs", () => {
    expect(PLAN_PROMPT).toContain("fold every decision and correction from the conversation into the plan");
    expect(PLAN_PROMPT).toContain("name the existing pi or MyPi API you checked and why it falls short");
    expect(PLAN_PROMPT).toContain("Read files with the read tool");
    expect(PLAN_PROMPT).toContain("If the user asks for a change while plan mode is on, don't attempt it");
    expect(PLAN_PROMPT).toContain("never offer switching modes as an ask_user answer");
  });

  it("starts in Plan when nothing is saved, with Plan's footer and prompt", () => {
    const { session, setStatus } = fakeSession();
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<warning>PLAN");
    expect(promptSection(session)).toBe(PLAN_PROMPT);
  });

  // A resumed session or a /reload builds a new, empty PromptManager, so init() must set the text again.
  it("restores the saved mode, with its footer and prompt", () => {
    const { session, setStatus } = fakeSession([saved("build")]);
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<dim>BUILD");
    expect(promptSection(session)).toBe(buildPrompt());
    expect(promptSection(session)).toContain("before-done checklist");
    expect(promptSection(session)).toContain("if it has one");
  });

  it("restores the implementing plan path from saved state", () => {
    const { session } = fakeSession([saved("build", ".pi/plans/p.md")]);
    new PlanBuildModule(session).init();
    expect(promptSection(session)).toContain("Implementing .pi/plans/p.md; re-read it when unsure what's left.");
  });

  // The session file can hold anything, so a bad value must still leave a mode and a label.
  it("falls back to Plan when the saved mode isn't one", () => {
    const { session, setStatus } = fakeSession([saved(42)]);
    new PlanBuildModule(session).init();
    expect(setStatus).toHaveBeenCalledWith("mypi-plan-build", "<warning>PLAN");
  });

  // init() runs on every /reload, so saving there would add an entry each time.
  it("restores a saved thinking level once, then saves state without it", () => {
    const { session, appendEntry } = fakeSession([saved("build", ".pi/plans/p.md", "low")]);
    new PlanBuildModule(session).init();

    expect(session.pi.setThinkingLevel).toHaveBeenCalledWith("low");
    expect(appendEntry).toHaveBeenCalledWith("mypi-module-plan-build", { mode: "build", plan: ".pi/plans/p.md" });
  });

  // A new session starts on the settings' default model; seen 2026-10-26 when a DeepSeek checkpoint opened on GPT.
  it("switches to the carried model before the first run, then sets the thinking level", async () => {
    const entry = customEntry("mypi-module-plan-build", {
      mode: "build",
      thinking: "low",
      model: "opencode-go/ds-flash",
    });
    const { session, emit, appendEntry } = fakeSession([entry]);
    new PlanBuildModule(session).init();
    await emit("before_agent_start", { type: "before_agent_start" });

    expect(session.pi.setModel).toHaveBeenCalledWith({ provider: "opencode-go", id: "ds-flash" });
    expect(vi.mocked(session.pi.setModel).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(session.pi.setThinkingLevel).mock.invocationCallOrder[0] ?? 0,
    );
    expect(appendEntry).toHaveBeenLastCalledWith("mypi-module-plan-build", { mode: "build", plan: undefined });
  });

  it("holds the first run until the carried model is set", async () => {
    const entry = customEntry("mypi-module-plan-build", { mode: "build", model: "opencode-go/ds-flash" });
    const { session, emit } = fakeSession([entry]);
    let finishSwitch = (_ok: boolean) => {};
    vi.mocked(session.pi.setModel).mockReturnValueOnce(new Promise((resolve) => (finishSwitch = resolve)));
    new PlanBuildModule(session).init();

    let started = false;
    const run = emit("before_agent_start", { type: "before_agent_start" }).then(() => (started = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(false);

    finishSwitch(true);
    await run;
    expect(started).toBe(true);
  });

  it("says so when the carried model can't be used, and keeps the session's", async () => {
    const entry = customEntry("mypi-module-plan-build", { mode: "build", model: "opencode-go/ds-flash" });
    const { session, emit, notify } = fakeSession([entry]);
    vi.mocked(session.pi.setModel).mockResolvedValueOnce(false);
    new PlanBuildModule(session).init();
    await emit("before_agent_start", { type: "before_agent_start" });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("couldn't switch to opencode-go/ds-flash"), "warning");
  });

  it("drops an invalid saved thinking level without restoring it", () => {
    const { session, appendEntry } = fakeSession([saved("build", undefined, "extreme")]);
    new PlanBuildModule(session).init();

    expect(session.pi.setThinkingLevel).not.toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith("mypi-module-plan-build", { mode: "build", plan: undefined });
  });

  it("doesn't save on init", () => {
    const { session, appendEntry } = fakeSession([saved("build")]);
    new PlanBuildModule(session).init();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("answers mode on the bus with the current mode", async () => {
    const { session, run } = startPlanBuild();
    expect(await ask(session.pi.events, "mode", undefined)).toEqual([
      { from: "plan-build", kind: "answer", value: "plan" },
    ]);
    await run("build");
    expect(await ask(session.pi.events, "mode", undefined)).toMatchObject([{ value: "build" }]);
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
    ])("sets %s from %s", async (arg, from, label) => {
      const { run, setStatus, appendEntry } = startPlanBuild([saved(from)]);
      await run(arg);
      expect(appendEntry).toHaveBeenLastCalledWith("mypi-module-plan-build", { mode: arg });
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", label);
    });

    it("throws on an unknown mode and leaves the mode alone", async () => {
      const { run, setStatus, appendEntry } = startPlanBuild();
      await expect(run("foo")).rejects.toThrow("Unknown mode: foo (use plan, build, or implement)");
      expect(appendEntry).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });
  });

  describe("/plan implement", () => {
    it("starts a new session in Build with the given plan", async () => {
      const { module } = startPlanBuild();
      const cwd = await mkdtemp(join(tmpdir(), "mypi-plan-implement-"));
      try {
        await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
        await writeFile(join(cwd, ".pi", "plans", "p.md"), "# P\n");
        const appendCustomEntry = vi.fn();
        const sendUserMessage = vi.fn(() => new Promise<void>(() => {}));
        const ctx = {
          cwd,
          waitForIdle: async () => {},
          sessionManager: { getSessionFile: () => undefined },
          newSession: async (options: {
            setup: (m: unknown) => Promise<void>;
            withSession: (c: unknown) => Promise<void>;
          }) => {
            await options.setup({ appendCustomEntry });
            await options.withSession({ hasUI: true, sendUserMessage });
            return { cancelled: false };
          },
        };
        const plan = module.commands().find((command) => command.info.name === "plan");
        await expect(plan?.execute(ctx as never, ["implement", ".pi/plans/p.md"])).resolves.toBeUndefined();
        // The new session's init() reads this entry, so it starts in Build.
        expect(appendCustomEntry).toHaveBeenCalledWith("mypi-module-plan-build", {
          mode: "build",
          plan: join(cwd, ".pi", "plans", "p.md"),
          thinking: "high",
        });
        expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("# P"));
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });

    // The current session keeps its mode; only the new one starts in Build.
    it("leaves this session's mode alone", async () => {
      const { run, appendEntry } = startPlanBuild();
      await expect(run("implement")).rejects.toThrow();
      expect(appendEntry).not.toHaveBeenCalled();
    });
  });

  describe("prompt section", () => {
    // Leaving Plan replaces the text instead of dropping it, so the model is told the restrictions are gone.
    it("follows each switch, and is never dropped", async () => {
      const { session, run } = startPlanBuild();
      await run("build");
      expect(promptSection(session)).toBe(buildPrompt());
      await run();
      expect(promptSection(session)).toBe(PLAN_PROMPT);
      expect(promptSection(session)).not.toContain("Implementing");
    });
  });

  describe("tool rule", () => {
    // No UI, so an ask comes back as a block that lists the question.
    const ctx = { cwd: "/project", hasUI: false } as ExtensionContext;
    const call = (toolName: string, input: Record<string, unknown>) =>
      ({ type: "tool_call", toolCallId: "call-1", toolName, input }) as ToolCallEvent;
    const writeSrc = call("write", { path: "src/a.ts", content: "" });

    // The rule reads the mode on each call, so a switch mid-run reaches the next tool call.
    it("follows each switch on the next call", async () => {
      const { session, run } = startPlanBuild();
      await run("build");
      await expect(session.toolGuard.check(writeSrc, ctx)).resolves.toBeUndefined();
      await run("plan");
      await expect(session.toolGuard.check(writeSrc, ctx)).resolves.toMatchObject({ block: true });
    });
  });

  describe("Plan tools", () => {
    it("are active on init in Plan, and only then", () => {
      expect(startPlanBuild().activeTools()).toEqual(["read", "bash", "edit", "write", "submit_plan", "ask_user"]);
      expect(startPlanBuild([saved("build")]).activeTools()).toEqual(["read", "bash", "edit", "write"]);
    });

    // Leaving Plan removes only Plan's tools, so tools the user turned on or off in the meantime stay as they are.
    it("are added on entering Plan and removed on leaving, leaving other tools alone", async () => {
      const { session, run, activeTools } = startPlanBuild();
      session.pi.registerTool({ name: "mcp_search" } as ToolDefinition);
      session.pi.setActiveTools(["read", "submit_plan", "ask_user", "mcp_search"]);
      await run("build");
      expect(activeTools()).toEqual(["read", "mcp_search"]);
      await run("plan");
      expect(activeTools()).toEqual(["read", "mcp_search", "submit_plan", "ask_user"]);
    });
  });

  describe("plan dialog", () => {
    const settled = (aborted = false) => ({ type: "agent_settled", aborted });

    /** A started module whose submit_plan ran in `cwd`, as during a run. */
    async function submitted(branch: unknown[] = []) {
      const cwd = await mkdtemp(join(tmpdir(), "mypi-dialog space-"));
      const fake = startPlanBuild(branch, cwd);
      cleanups.push(() => rm(cwd, { recursive: true, force: true }));
      await fake.emit("before_agent_start", {});
      await fake.tools
        .get("submit_plan")
        ?.execute("call-1", { title: "Add it", plan: "Steps." }, undefined, undefined, { cwd } as never);
      const ctx = { cwd, hasUI: true, ui: { select: fake.select }, signal: undefined } as unknown as ExtensionContext;
      return { ...fake, cwd, ctx };
    }
    const cleanups: (() => Promise<void>)[] = [];
    afterEach(async () => {
      for (const cleanup of cleanups.splice(0)) await cleanup();
    });

    it("asks once a run that submitted a plan settles, naming the plan and its file", async () => {
      const { emit, ctx, select } = await submitted();
      await emit("agent_settled", settled(), ctx);
      expect(select).toHaveBeenCalledTimes(1);
      const [title, options] = select.mock.calls[0] ?? [];
      expect(title).toMatch(/^Implement this plan\?\nAdd it \(\.pi\/plans\/\d{4}-\d\d-\d\d-\d{6}-add-it\.md\)$/);
      expect(options).toEqual(["Clear context and implement", "Implement", "Stay in plan mode"]);
    });

    it("Implement switches to Build, then asks the model to implement", async () => {
      const { emit, ctx, select, sendUserMessage, setStatus, appendEntry, activeTools, session } = await submitted();
      select.mockResolvedValueOnce("Implement");
      await emit("agent_settled", settled(), ctx);
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<dim>BUILD");
      expect(appendEntry).toHaveBeenLastCalledWith("mypi-module-plan-build", {
        mode: "build",
        plan: expect.stringContaining("add-it.md"),
      });
      expect(promptSection(session)).toContain("Implementing");
      expect(activeTools()).not.toContain("submit_plan");
      expect(sendUserMessage).toHaveBeenCalledWith("Implement the plan.");
      // The message runs under Build's prompt, so the switch must come first.
      expect(setStatus.mock.invocationCallOrder.at(-1)).toBeLessThan(sendUserMessage.mock.invocationCallOrder[0] ?? 0);
    });

    // Only a command's context can start a session, so the choice runs /plan implement with the plan's file.
    it("Clear context and implement runs /plan implement with the plan's file, staying in Plan here", async () => {
      const { emit, ctx, select, sendUserMessage, setStatus } = await submitted();
      select.mockResolvedValueOnce("Clear context and implement");
      await emit("agent_settled", settled(), ctx);
      expect(sendUserMessage).toHaveBeenCalledWith(
        expect.stringMatching(/^\/plan implement file:\/\/.*\/\d{4}-\d\d-\d\d-\d{6}-add-it\.md$/),
        { expandPromptTemplates: true },
      );
      const dispatch = sendUserMessage.mock.calls[0]?.[0] as string;
      const file = dispatch.split(/\s+/)[2];
      expect(fileURLToPath(file ?? "")).toContain(ctx.cwd);
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });

    it.each([["Stay in plan mode"], [undefined]])("%j keeps planning and sends nothing", async (answer) => {
      const { emit, ctx, select, sendUserMessage, setStatus } = await submitted();
      select.mockResolvedValueOnce(answer);
      await emit("agent_settled", settled(), ctx);
      expect(sendUserMessage).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenLastCalledWith("mypi-plan-build", "<warning>PLAN");
    });

    it("asks only once per submitted plan", async () => {
      const { emit, ctx, select } = await submitted();
      await emit("agent_settled", settled(), ctx);
      await emit("agent_settled", settled(), ctx);
      expect(select).toHaveBeenCalledTimes(1);
    });

    it("doesn't ask when the run didn't submit a plan", async () => {
      const { emit, select } = startPlanBuild();
      await emit("agent_settled", settled());
      expect(select).not.toHaveBeenCalled();
    });

    // A plan from an earlier run belongs to that run; the next run starts without one.
    it("doesn't ask about a plan submitted in an earlier run", async () => {
      const { emit, ctx, select } = await submitted();
      await emit("before_agent_start", {});
      await emit("agent_settled", settled(), ctx);
      expect(select).not.toHaveBeenCalled();
    });

    it("doesn't ask when the run was aborted", async () => {
      const { emit, ctx, select } = await submitted();
      await emit("agent_settled", settled(true), ctx);
      expect(select).not.toHaveBeenCalled();
    });

    it("doesn't ask without a UI", async () => {
      const { emit, ctx, select } = await submitted();
      await emit("agent_settled", settled(), { ...ctx, hasUI: false });
      expect(select).not.toHaveBeenCalled();
    });

    // The user switched to Build during the run, so they're already driving.
    it("doesn't ask when the mode is already Build", async () => {
      const { emit, ctx, select, run } = await submitted();
      await run("build");
      await emit("agent_settled", settled(), ctx);
      expect(select).not.toHaveBeenCalled();
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
