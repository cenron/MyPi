import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPlan, implementInNewSession } from "#module/plan-build/implement";
import { savePlan } from "#module/plan-build/plan-file";
import { implementMessage } from "#module/plan-build/prompts";

/**
 * A command context whose `newSession` runs `setup` and `withSession` the way pi does, against `newManager` and
 * `newCtx`, unless `cancelled`. The new session's `sendUserMessage` never resolves, like a run that's still going.
 */
function fakeCommandContext(cwd: string, { cancelled = false, send = () => new Promise<void>(() => {}) } = {}) {
  const newManager = { appendCustomEntry: vi.fn() } as unknown as SessionManager;
  const sendUserMessage = vi.fn(send);
  const notify = vi.fn();
  // pi doesn't export ReplacedSessionContext, so the cast goes through `never`.
  const newCtx = { hasUI: true, ui: { notify }, sendUserMessage } as never;
  const newSession = vi.fn(async (options: Parameters<ExtensionCommandContext["newSession"]>[0]) => {
    if (cancelled) return { cancelled: true };
    await options?.setup?.(newManager);
    await options?.withSession?.(newCtx);
    return { cancelled: false };
  });
  const waitForIdle = vi.fn(async () => {});
  const ctx = {
    cwd,
    waitForIdle,
    newSession,
    sessionManager: { getSessionFile: () => "/sessions/old.jsonl" },
  } as unknown as ExtensionCommandContext;
  return { ctx, newSession, newManager, sendUserMessage, notify, waitForIdle };
}

let cwd: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "mypi-implement-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("findPlan", () => {
  it("resolves the argument the way the file tools do", async () => {
    await expect(findPlan(cwd, ".pi/plans/a.md")).resolves.toBe(join(cwd, ".pi", "plans", "a.md"));
    await expect(findPlan(cwd, "@notes/p.md")).resolves.toBe(join(cwd, "notes", "p.md"));
    await expect(findPlan(cwd, "~/p.md")).resolves.toBe(join(homedir(), "p.md"));
  });

  it("is the latest plan without an argument", async () => {
    await savePlan(cwd, "old", "x", new Date("2026-10-19T00:00:00Z"));
    const newest = await savePlan(cwd, "new", "x", new Date("2026-10-20T00:00:00Z"));
    await expect(findPlan(cwd, undefined)).resolves.toBe(newest);
  });

  it("throws when there's no plan to implement", async () => {
    await expect(findPlan(cwd, undefined)).rejects.toThrow("No plans in .pi/plans/ to implement");
  });
});

describe("implementInNewSession", () => {
  const writePlan = async () => {
    const path = join(cwd, "plan.md");
    await writeFile(path, "# T\n\nSteps.\n");
    return path;
  };

  it("starts a new session with this one as its parent, once the agent is idle", async () => {
    const { ctx, newSession, waitForIdle } = fakeCommandContext(cwd);
    await implementInNewSession(ctx, await writePlan(), () => {});
    expect(newSession).toHaveBeenCalledWith(expect.objectContaining({ parentSession: "/sessions/old.jsonl" }));
    expect(waitForIdle.mock.invocationCallOrder[0]).toBeLessThan(newSession.mock.invocationCallOrder[0] ?? 0);
  });

  it("lets the caller seed the new session before it starts", async () => {
    const { ctx, newManager } = fakeCommandContext(cwd);
    const seed = vi.fn();
    await implementInNewSession(ctx, await writePlan(), seed);
    expect(seed).toHaveBeenCalledWith(newManager);
  });

  it("sends the hand-off text, the plan's path, and the plan as the new session's first message", async () => {
    const { ctx, sendUserMessage } = fakeCommandContext(cwd);
    const path = await writePlan();
    await implementInNewSession(ctx, path, () => {});
    expect(sendUserMessage).toHaveBeenCalledWith(implementMessage(path, "# T\n\nSteps.\n"));
    expect(implementMessage(path, "P")).toMatch(
      /^A previous agent produced the plan below[\s\S]*\nPlan file: .*\n\nP$/,
    );
  });

  // The message's promise resolves when the new run ends; the fake's never does, so awaiting it would hang here.
  it("doesn't wait for the new session's run, and shows nothing after the switch", async () => {
    const { ctx } = fakeCommandContext(cwd);
    await expect(implementInNewSession(ctx, await writePlan(), () => {})).resolves.toBeUndefined();
  });

  it("shows a failed first message in the new session", async () => {
    const { ctx, notify } = fakeCommandContext(cwd, { send: () => Promise.reject(new Error("no model")) });
    await implementInNewSession(ctx, await writePlan(), () => {});
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("no model", "error"));
  });

  it("says so when the new session is cancelled", async () => {
    const { ctx } = fakeCommandContext(cwd, { cancelled: true });
    await expect(implementInNewSession(ctx, await writePlan(), () => {})).resolves.toBe(
      "New session cancelled; still in this one.",
    );
  });

  it("fails before leaving the session when the plan can't be read", async () => {
    const { ctx, newSession } = fakeCommandContext(cwd);
    await expect(implementInNewSession(ctx, join(cwd, "missing.md"), () => {})).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(newSession).not.toHaveBeenCalled();
  });
});
