import { type ExtensionContext, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { answer } from "#core/events";
import { planRule } from "#core/plan-rule";
import type { AgentDefinition } from "#module/subagents/agents";
import { type ChildResult, changedPath, runChild, runUsage } from "#module/subagents/child";
import { subagentTool } from "#module/subagents/tools/subagent";
import { fakeSession } from "../../fakes";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const explore: AgentDefinition = {
  name: "explore",
  description: "Search",
  access: "read-only",
  model: "inherit",
  thinking: "inherit",
  prompt: "Search",
  source: "builtin",
  path: "/builtins/explore.md",
};

const result: ChildResult = {
  answer: "Found it in src/a.ts:3.",
  usage: { tokens: 1200, cost: 0.0042 },
  sessionFile: "/sessions/child.jsonl",
  changedFiles: ["src/a.ts"],
  timedOut: false,
};

function setup(agents: AgentDefinition[] = [explore], run = vi.fn<typeof runChild>(async () => result)) {
  const fake = fakeSession();
  const tool = subagentTool(fake.session, () => agents, run);
  const call = (args: Record<string, unknown>) =>
    tool.execute("call", args as never, undefined, undefined, fake.session.ctx as never);
  const text = async (args: Record<string, unknown>) => {
    const response = await call({ background: false, ...args });
    return response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  };
  return { ...fake, tool, call, text, run };
}

/** Resolves once job `id` has ended and its notice, if any, has gone out. */
async function settled(session: ReturnType<typeof fakeSession>["session"], id: string) {
  await session.jobs.get(id)?.done;
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("subagent", () => {
  it("names the agents there are when asked for an unknown one", async () => {
    const { call } = setup();
    await expect(call({ agent: "missing", task: "x" })).rejects.toThrow("Agents: explore.");
  });

  // `undefined` leaves the choice to the child: the parent's model and thinking level.
  it.each([
    ["inherited", {}, {}, { model: undefined, thinking: undefined }],
    ["the agent's own", { model: "openai/a", thinking: "low" }, {}, { model: "openai/a", thinking: "low" }],
    [
      "the call's, over the agent's",
      { model: "openai/a", thinking: "low" },
      { model: "openai/b", thinking: "high" },
      { model: "openai/b", thinking: "high" },
    ],
    [
      "inherited, when the call says inherit",
      { model: "openai/a", thinking: "low" },
      { model: "inherit", thinking: "inherit" },
      { model: undefined, thinking: undefined },
    ],
  ])("gives the child %s model and thinking", async (_name, agentFields, callFields, settings) => {
    const { text, run } = setup([{ ...explore, ...agentFields } as AgentDefinition]);
    await text({ agent: "explore", task: "Find", ...callFields });
    expect(run.mock.calls[0]?.[0].settings).toEqual(settings);
  });

  it("lets a read-only agent run the project's approved checks, and doesn't pass them to a writer", async () => {
    const developer = { ...explore, name: "developer", access: "write" as const };
    const { text, run, session } = setup([explore, developer]);
    answer(session.pi.events, "checkCommands", "done-check", () => ["npm run check"]);

    await text({ agent: "explore", task: "Review" });
    await text({ agent: "developer", task: "Build" });

    expect(run.mock.calls[0]?.[0].checks).toEqual(["npm run check"]);
    expect(run.mock.calls[1]?.[0].checks).toBeUndefined();
  });

  describe("drawing", () => {
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;
    const context = { lastComponent: undefined, isPartial: true } as never;
    const drawn = (component: { render(width: number): string[] } | undefined) =>
      component
        ?.render(100)
        .map((line) => line.trimEnd())
        .join("\n");

    it("draws a call as the agent and the start of the task's first line", () => {
      const { tool } = setup();
      const call = tool.renderCall?.({ agent: "explore", task: "Find it\nThen check" } as never, theme, context);
      expect(drawn(call)).toBe("subagent explore Find it");
    });

    it("streams a foreground run's steps, the last five until expanded", async () => {
      const steps = Array.from({ length: 7 }, (_, step) => `read: ${step + 1}.ts`);
      const run = vi.fn<typeof runChild>(async (...args) => {
        for (const step of steps) args[0].onStep(step);
        return result;
      });
      const { tool, session } = setup([explore], run);
      const updates: unknown[] = [];
      await tool.execute(
        "call",
        { agent: "explore", task: "Find", background: false },
        undefined,
        (update) => updates.push(update),
        session.ctx as never,
      );

      const last = updates.at(-1) as never;
      const collapsed = drawn(tool.renderResult?.(last, { expanded: false, isPartial: true }, theme, context));
      expect(collapsed).toContain("… 2 earlier steps");
      expect(collapsed).not.toContain("read: 2.ts");
      expect(collapsed).toContain("read: 7.ts");
      const expanded = drawn(tool.renderResult?.(last, { expanded: true, isPartial: true }, theme, context));
      expect(expanded).toContain("read: 1.ts");
    });
  });

  it("returns the answer, usage, session file, and changed files when not in the background", async () => {
    const { text } = setup();
    expect(await text({ agent: "explore", task: "Find" })).toBe(
      "Found it in src/a.ts:3.\n\nUsage: 1200 tokens, $0.0042\n\nSession: /sessions/child.jsonl\n\nChanged files: src/a.ts",
    );
  });

  it("says a run that changed nothing changed nothing", async () => {
    const { text } = setup(
      [explore],
      vi.fn(async () => ({ ...result, changedFiles: [] })),
    );
    expect(await text({ agent: "explore", task: "Find" })).toContain("Changed files: none");
  });

  it("says a run stopped at the time limit was stopped", async () => {
    const { text } = setup(
      [explore],
      vi.fn(async () => ({ ...result, timedOut: true })),
    );
    expect(await text({ agent: "explore", task: "Find" })).toMatch(/^Stopped at the 30-minute limit/);
  });

  it("runs in the background as a subagent job whose notice carries the whole answer", async () => {
    vi.useFakeTimers();
    const answer = Array.from({ length: 40 }, (_, line) => `line ${line + 1}`).join("\n");
    const { call, session, sendMessage } = setup(
      [explore],
      vi.fn(async () => ({ ...result, answer })),
    );
    await call({ agent: "explore", task: "Find\nmore detail" });
    expect(session.jobs.list()).toMatchObject([{ kind: "subagent", label: "explore: Find" }]);

    await session.jobs.get("1")?.done;
    await vi.advanceTimersByTimeAsync(3_000);
    const [message, options] = sendMessage.mock.calls[0] ?? [];
    expect(message).toMatchObject({ customType: "mypi-job" });
    expect(message.content).toContain(`explore: Find\n\n${answer}`);
    expect(options).toEqual({ deliverAs: "followUp", triggerTurn: true });
  });

  it("brings background runs that end together in one message", async () => {
    vi.useFakeTimers();
    const run = vi.fn<typeof runChild>(async ({ task }) => ({ ...result, answer: `answer to ${task}` }));
    const { call, session, sendMessage } = setup([explore], run);
    await call({ agent: "explore", task: "one" });
    await call({ agent: "explore", task: "two" });
    await Promise.all(["1", "2"].map((id) => session.jobs.get(id)?.done));

    await vi.advanceTimersByTimeAsync(2_999);
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledOnce();
    const { content } = sendMessage.mock.calls[0]?.[0] ?? {};
    expect(content).toContain("answer to one");
    expect(content).toContain("answer to two");
  });

  it("labels a job with the agent and the start of the task's first line", async () => {
    const { call, session } = setup();
    await call({ agent: "explore", task: `${"a".repeat(70)}\nmore` });
    expect(session.jobs.list()[0]?.label).toBe(`explore: ${"a".repeat(59)}…`);
  });

  it("reports a background run that failed with its error", async () => {
    const run = vi.fn<typeof runChild>(async () => {
      throw new Error("No model is selected.");
    });
    const { call, session, sendMessage } = setup([explore], run);
    await call({ agent: "explore", task: "Find" });
    await settled(session, "1");
    expect(sendMessage.mock.calls[0]?.[0].content).toContain("Error: No model is selected.");
  });

  // Plan asks before any tool not marked read-only; the tool itself refuses a write agent in Plan.
  it("runs in Plan without asking", () => {
    const { tool } = setup();
    const env = { cwd: "/project", home: "/home/me", writableDirs: [], writableTools: new Set<string>() };
    expect(planRule({ toolName: "subagent", input: {}, annotations: tool.annotations }, env)).toEqual({
      kind: "allow",
    });
  });

  it("blocks write agents in Plan and allows read-only agents", async () => {
    const { call, session } = setup([explore, { ...explore, name: "developer", access: "write" }]);
    answer(session.pi.events, "mode", "plan-test", () => "plan");
    await expect(call({ agent: "developer", task: "Change it" })).rejects.toThrow(
      "Plan mode is on: developer can change files",
    );
    await expect(call({ agent: "explore", task: "Search" })).resolves.toMatchObject({ details: expect.any(Object) });
  });

  it("allows only one write run at once, while read-only runs can proceed", async () => {
    let finish: (() => void) | undefined;
    const write = { ...explore, name: "developer", access: "write" as const };
    const { call, text, session } = setup(
      [explore, write],
      vi.fn(({ agent }) =>
        agent.access === "write"
          ? new Promise<ChildResult>((resolve) => {
              finish = () => resolve(result);
            })
          : Promise.resolve(result),
      ),
    );
    await call({ agent: "developer", task: "Hold" });
    await expect(call({ agent: "developer", task: "Second" })).rejects.toThrow(
      "Only one write subagent runs at a time",
    );
    await expect(text({ agent: "explore", task: "Search" })).resolves.toContain("Found it");
    finish?.();
    await settled(session, "1");
    await expect(call({ agent: "developer", task: "Now allowed" })).resolves.toMatchObject({
      details: expect.any(Object),
    });
  });

  it("runs at most three in the background at once", async () => {
    const { call } = setup(
      [explore],
      vi.fn(() => new Promise<ChildResult>(() => {})),
    );
    for (let run = 0; run < 3; run++) await call({ agent: "explore", task: "hold" });
    await expect(call({ agent: "explore", task: "fourth" })).rejects.toThrow("At most 3 background subagents");
  });

  it("starts at most eight per user prompt; a notice's turn doesn't start a new count", async () => {
    const { text, emit } = setup();
    for (let run = 0; run < 8; run++) await text({ agent: "explore", task: "quick" });
    await expect(text({ agent: "explore", task: "ninth" })).rejects.toThrow("At most 8");

    await emit("input", { source: "extension" });
    await expect(text({ agent: "explore", task: "ninth" })).rejects.toThrow("At most 8");
    await emit("input", { source: "interactive" });
    await expect(text({ agent: "explore", task: "next prompt" })).resolves.toContain("Found it");
  });
});

describe("runChild", () => {
  it("doesn't continue child setup when stopped during runtime startup", async () => {
    let finishRuntime: (runtime: ModelRuntime) => void = () => {};
    const runtime = new Promise<ModelRuntime>((resolve) => {
      finishRuntime = resolve;
    });
    vi.spyOn(ModelRuntime, "create").mockReturnValue(runtime);
    const controller = new AbortController();
    const parent = {
      model: {},
      cwd: "/project",
      sessionManager: { getSessionFile: () => undefined },
    } as unknown as ExtensionContext;
    const running = runChild({
      parent,
      agent: explore,
      task: "Find",
      settings: {},
      signal: controller.signal,
      onStep: () => {},
    });

    controller.abort();
    finishRuntime({} as ModelRuntime);

    await expect(running).rejects.toThrow("aborted");
  });

  it("fails with what to do when neither the parent nor the run names a model", async () => {
    const parent = { model: undefined } as ExtensionContext;
    await expect(
      runChild({
        parent,
        agent: explore,
        task: "Find",
        settings: {},
        signal: new AbortController().signal,
        onStep: () => {},
      }),
    ).rejects.toThrow("No model is selected. Select one with /model, or pass `model`.");
  });

  it.each([
    ["write", { path: "a.ts" }, "a.ts"],
    ["edit", { path: "a.ts" }, "a.ts"],
    ["read", { path: "a.ts" }, undefined],
  ])("takes the changed file of a %s call", (tool, args, path) => {
    expect(changedPath(tool, args)).toBe(path);
  });

  it("adds up the usage of every reply", () => {
    const reply = (tokens: number, cost: number) => ({
      role: "assistant",
      usage: { totalTokens: tokens, cost: { total: cost } },
    });
    expect(runUsage([reply(100, 0.5), { role: "user" }, reply(50, 0.25)])).toEqual({ tokens: 150, cost: 0.75 });
  });
});
