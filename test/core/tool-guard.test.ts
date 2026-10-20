import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext, ToolAnnotations, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ToolGuard, type ToolRule, type Verdict } from "#core/tool-guard";

/** A guard over a fake pi whose `getAllTools()` lists `tools`. */
function newGuard(tools: { name: string; annotations?: ToolAnnotations }[] = []) {
  return new ToolGuard({ getAllTools: () => tools } as unknown as ExtensionAPI);
}

/** A tool call's context: `confirm` answers `answer`, and `signal` is a real one so tests can check it's passed on. */
function fakeContext({ hasUI = true, answer = true } = {}) {
  const confirm = vi.fn(async (_title: string, _message: string, _opts?: { signal?: AbortSignal }) => answer);
  const signal = new AbortController().signal;
  const ctx = { cwd: "/project", hasUI, signal, ui: { confirm } } as unknown as ExtensionContext;
  return { ctx, confirm, signal };
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
  it("lets a call run when no rule is set", async () => {
    await expect(newGuard().check(event(), fakeContext().ctx)).resolves.toBeUndefined();
  });

  it("lets a call run when every rule allows it", async () => {
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
      { cwd: "/project", home: homedir() },
    );
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
    const { ctx, confirm } = fakeContext();
    await expect(guard.check(event(), ctx)).resolves.toEqual({ block: true, reason: "no" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks once for every asking rule, naming each, and passes the call's signal", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    guard.set("quiet", allow);
    guard.set("two", ask("Really?"));
    const { ctx, confirm, signal } = fakeContext();
    await guard.check(event(), ctx);
    expect(confirm).toHaveBeenCalledTimes(1);
    const [, message, opts] = confirm.mock.calls[0] ?? [];
    expect(message).toBe("one: Run ls?\n\ntwo: Really?");
    expect(opts?.signal).toBe(signal);
  });

  it("lets the call run when the user confirms", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    await expect(guard.check(event(), fakeContext({ answer: true }).ctx)).resolves.toBeUndefined();
  });

  // confirm also resolves false on Escape and when the signal aborts.
  it("blocks when the user declines", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    await expect(guard.check(event(), fakeContext({ answer: false }).ctx)).resolves.toEqual({
      block: true,
      reason: "The user declined this call.",
    });
  });

  it("blocks without a UI, telling the model what needed confirming", async () => {
    const guard = newGuard();
    guard.set("one", ask("Run ls?"));
    const { ctx, confirm } = fakeContext({ hasUI: false });
    const result = await guard.check(event(), ctx);
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("one: Run ls?");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("replaces a rule set again under the same name", async () => {
    const guard = newGuard();
    guard.set("one", block("old"));
    guard.set("one", allow);
    await expect(guard.check(event(), fakeContext().ctx)).resolves.toBeUndefined();
  });

  it("clears a rule set to undefined", async () => {
    const guard = newGuard();
    guard.set("one", block("no"));
    guard.set("one", undefined);
    await expect(guard.check(event(), fakeContext().ctx)).resolves.toBeUndefined();
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
