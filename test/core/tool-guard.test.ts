import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, ToolAnnotations, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { previewAsk, ToolGuard, type ToolRule, type Verdict } from "#core/tool-guard";

/** A guard over a fake pi whose `getAllTools()` lists `tools`. */
function newGuard(tools: { name: string; annotations?: ToolAnnotations }[] = []) {
  return new ToolGuard({ getAllTools: () => tools } as unknown as ExtensionAPI);
}

/**
 * A tool call's context: `select` picks `answer` (undefined is Esc or an abort), and `signal` is a real one so tests
 * can check it's passed on.
 */
function fakeContext(options: { hasUI?: boolean; answer?: string | undefined } = {}) {
  // A default parameter would turn an explicit `answer: undefined` (Esc) into "Yes".
  const { hasUI = true } = options;
  const answer = "answer" in options ? options.answer : "Yes";
  const select = vi.fn(
    async (_title: string, _options: string[], _opts?: { signal?: AbortSignal }): Promise<string | undefined> => answer,
  );
  const signal = new AbortController().signal;
  const ctx = { cwd: "/project", hasUI, signal, ui: { select } } as unknown as ExtensionContext;
  return { ctx, select, signal };
}

const event = (toolName = "bash", input: Record<string, unknown> = { command: "ls" }) =>
  ({ type: "tool_call", toolCallId: "call-1", toolName, input }) as ToolCallEvent;

const rule =
  (verdict: Verdict): ToolRule =>
  () =>
    verdict;
const allow = rule({ kind: "allow" });
const ask = (question: string) => rule({ kind: "ask", question });
const block = (reason: string) => rule({ kind: "block", reason });

describe("ToolGuard", () => {
  it("lets a call run when no rule is set, or every rule allows it", async () => {
    await expect(newGuard().check(event(), fakeContext().ctx)).resolves.toBeUndefined();
    const guard = newGuard();
    guard.set("one", allow);
    guard.set("two", allow);
    await expect(guard.check(event(), fakeContext().ctx)).resolves.toBeUndefined();
  });

  it("passes each rule the call, the tool's annotations, and the environment", async () => {
    const guard = newGuard([{ name: "mcp__fs__read", annotations: { readOnlyHint: true } }]);
    const seen = vi.fn(allow);
    guard.set("one", seen);
    await guard.check(event("mcp__fs__read", { path: "a.txt" }), fakeContext().ctx);
    expect(seen).toHaveBeenCalledWith(
      { toolName: "mcp__fs__read", input: { path: "a.txt" }, annotations: { readOnlyHint: true } },
      { cwd: "/project", home: homedir(), writableDirs: [], writableTools: new Set() },
    );
  });

  // Read on every call, so a module that sets its writable after another's rule is still seen.
  it("passes every module's writable folders and tools, merged, until one is removed", async () => {
    const guard = newGuard();
    const seen = vi.fn(allow);
    guard.set("one", seen);
    guard.setWritable("plans", { dirs: ["/p/plans"], tools: ["submit_plan"] });
    guard.setWritable("memory", { dirs: ["/p/memories", "/g/memories"], tools: [] });
    await guard.check(event(), fakeContext().ctx);
    expect(seen).toHaveBeenLastCalledWith(expect.anything(), {
      cwd: "/project",
      home: homedir(),
      writableDirs: ["/p/plans", "/p/memories", "/g/memories"],
      writableTools: new Set(["submit_plan"]),
    });

    guard.setWritable("plans", undefined);
    await guard.check(event(), fakeContext().ctx);
    expect(seen).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ writableTools: new Set() }));
  });

  // An MCP tool whose server is still connecting isn't listed yet; its call must still go through the rules.
  it("still runs the rules for a tool pi doesn't list, with no annotations", async () => {
    const guard = newGuard();
    const seen = vi.fn(block("no"));
    guard.set("one", seen);
    await expect(guard.check(event("mcp__new__write"), fakeContext().ctx)).resolves.toEqual({
      block: true,
      reason: "no",
    });
    expect(seen.mock.calls[0]?.[0].annotations).toBeUndefined();
  });

  // Pi only reads `block`; returning the rule's own `{ kind: "block" }` would let the call run.
  it("blocks with the rule's reason, in pi's result shape", async () => {
    const guard = newGuard();
    guard.set("one", block("Plan mode is on."));
    await expect(guard.check(event(), fakeContext().ctx)).resolves.toEqual({ block: true, reason: "Plan mode is on." });
  });

  it("blocks without asking when any rule blocks, even after another rule asked", async () => {
    const guard = newGuard();
    guard.set("asker", ask("Run ls?"));
    guard.set("blocker", block("no"));
    const { ctx, select } = fakeContext();
    await expect(guard.check(event(), ctx)).resolves.toEqual({ block: true, reason: "no" });
    expect(select).not.toHaveBeenCalled();
  });

  it("asks once for every asking rule, naming each, and passes the call's signal", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    guard.set("quiet", allow);
    guard.set("two", ask("Really?"));
    const { ctx, select, signal } = fakeContext();
    await guard.check(event(), ctx);
    expect(select).toHaveBeenCalledTimes(1);
    const [title, options, opts] = select.mock.calls[0] ?? [];
    expect(title).toBe("Permission required\none: Run ls?\n\ntwo: Really?");
    expect(options).toEqual(["Yes", "No", "Allow for this session"]);
    expect(opts?.signal).toBe(signal);
  });

  it("lets the call run when the user picks Yes", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    await expect(guard.check(event(), fakeContext({ answer: "Yes" }).ctx)).resolves.toBeUndefined();
  });

  // select resolves undefined on Escape and when the signal aborts.
  it.each([["No"], [undefined]])("blocks when the user picks %j", async (answer) => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    await expect(guard.check(event(), fakeContext({ answer }).ctx)).resolves.toEqual({
      block: true,
      reason: "The user declined this call.",
    });
  });

  it("asks again next time after Yes", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    const { ctx, select } = fakeContext({ answer: "Yes" });
    await guard.check(event(), ctx);
    await guard.check(event(), ctx);
    expect(select).toHaveBeenCalledTimes(2);
  });

  describe("Allow for this session", () => {
    it("lets the call run, and the same ask line runs unasked after that", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      const first = fakeContext({ answer: "Allow for this session" });
      await expect(guard.check(event(), first.ctx)).resolves.toBeUndefined();
      const later = fakeContext({ answer: "No" });
      await expect(guard.check(event(), later.ctx)).resolves.toBeUndefined();
      expect(later.select).not.toHaveBeenCalled();
    });

    // Exact strings: allowing `npm test` must not allow `npm install`.
    it("still asks about a different question", async () => {
      let question = "Run npm test?";
      const guard = newGuard();
      guard.set("one", () => ({ kind: "ask", question }));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      question = "Run npm install?";
      const { ctx, select } = fakeContext({ answer: "No" });
      await expect(guard.check(event(), ctx)).resolves.toMatchObject({ block: true });
      expect(select).toHaveBeenCalledTimes(1);
    });

    // The line names the module, so another module asking the same question still asks.
    it("is per module", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      guard.set("two", ask("Run ls?"));
      const { ctx, select } = fakeContext({ answer: "Yes" });
      await guard.check(event(), ctx);
      expect(select.mock.calls[0]?.[0]).toBe("Permission required\ntwo: Run ls?");
    });

    it("lists only the asks not yet allowed", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      guard.set("two", ask("Really?"));
      const { ctx, select } = fakeContext({ answer: "Yes" });
      await guard.check(event(), ctx);
      expect(select.mock.calls[0]?.[0]).toBe("Permission required\ntwo: Really?");
    });

    it("remembers every line it listed", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      guard.set("two", ask("Really?"));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      const { ctx, select } = fakeContext({ answer: "No" });
      await expect(guard.check(event(), ctx)).resolves.toBeUndefined();
      expect(select).not.toHaveBeenCalled();
    });

    it("never overrides a block", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      guard.set("blocker", block("no"));
      await expect(guard.check(event(), fakeContext().ctx)).resolves.toEqual({ block: true, reason: "no" });
    });

    it("isn't remembered after No or Esc", async () => {
      const guard = newGuard();
      guard.set("one", ask("Run ls?"));
      await guard.check(event(), fakeContext({ answer: "No" }).ctx);
      await guard.check(event(), fakeContext({ answer: undefined }).ctx);
      const { ctx, select } = fakeContext({ answer: "Yes" });
      await guard.check(event(), ctx);
      expect(select).toHaveBeenCalledTimes(1);
    });
  });

  describe("a long ask", () => {
    const longCommand = ["python3 - <<'PY'", ...Array.from({ length: 30 }, (_, i) => `line ${i}`), "PY"].join("\n");

    it("shows a shortened question, saying how much is hidden", async () => {
      const guard = newGuard();
      guard.set("plan-build", ask(`Run this command?\n${longCommand}`));
      const { ctx, select } = fakeContext({ answer: "Yes" });
      await guard.check(event(), ctx);
      const title = select.mock.calls[0]?.[0] ?? "";
      expect(title).toContain("plan-build: Run this command?\npython3 - <<'PY'");
      expect(title).not.toContain("line 29");
      expect(title).toContain("more lines not shown. Yes allows all of it.");
    });

    // The dialog is cut, but approvals match the full text.
    it("doesn't let an approval for one long command cover another that starts the same", async () => {
      const guard = newGuard();
      let command = `${longCommand}\necho one`;
      guard.set("one", () => ({ kind: "ask", question: command }));
      await guard.check(event(), fakeContext({ answer: "Allow for this session" }).ctx);
      command = `${longCommand}\nrm -rf build`;
      const { ctx, select } = fakeContext({ answer: "No" });
      await expect(guard.check(event(), ctx)).resolves.toMatchObject({ block: true });
      expect(select).toHaveBeenCalledTimes(1);
    });
  });

  it("blocks without a UI, telling the model what needed confirming", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    const { ctx, select } = fakeContext({ hasUI: false });
    const result = await guard.check(event(), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("one: Run ls?");
    expect(select).not.toHaveBeenCalled();
  });

  // Pi turns a handler's throw into a blocked call, so a broken rule fails closed.
  it("lets a rule's error reach pi", async () => {
    const guard = newGuard();
    guard.set("broken", () => {
      throw new Error("rule bug");
    });
    await expect(guard.check(event(), fakeContext().ctx)).rejects.toThrow("rule bug");
  });
});

describe("previewAsk", () => {
  it("leaves an ask of up to 12 lines of up to 160 characters as is", () => {
    expect(previewAsk("one: Run ls?")).toBe("one: Run ls?");
    const atTheLimit = Array.from({ length: 12 }, () => "z".repeat(160)).join("\n");
    expect(previewAsk(atTheLimit)).toBe(atTheLimit);
  });

  it("keeps the first 12 lines and counts the rest", () => {
    const ask = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n");
    const lines = previewAsk(ask).split("\n");
    expect(lines).toHaveLength(13);
    expect(lines[11]).toBe("line 12");
    expect(lines[12]).toBe("… 3 more lines not shown. Yes allows all of it.");
    const oneOver = Array.from({ length: 13 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(previewAsk(oneOver)).toMatch(/… 1 more line not shown\./);
  });

  it("cuts a long line, counting the characters left out", () => {
    expect(previewAsk(`x${"y".repeat(199)}`)).toBe(`x${"y".repeat(159)}… (40 more characters)`);
  });
});
