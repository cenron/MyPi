import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobManager } from "#core/job-manager";
import { findPlan, implementInNewSession } from "#module/plan-build/commands/plan/implement";
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
  // resolveToolPath has the table; this checks findPlan goes through it.
  it("resolves the argument the way the file tools do", async () => {
    await expect(findPlan(join(cwd, ".pi", "plans"), cwd, "~/p.md")).resolves.toBe(join(homedir(), "p.md"));
  });

  it("is the latest plan without an argument", async () => {
    const plansDir = join(cwd, "main", ".pi", "plans");
    await savePlan(plansDir, "old", "x", new Date("2026-10-19T00:00:00Z"));
    const newest = await savePlan(plansDir, "new", "x", new Date("2026-10-20T00:00:00Z"));
    await expect(findPlan(plansDir, cwd, undefined)).resolves.toBe(newest);
  });

  it("throws when there's no plan to implement", async () => {
    await expect(findPlan(cwd, cwd, undefined)).rejects.toThrow(`No plans in ${cwd}/ to implement`);
  });
});

describe("implementInNewSession", () => {
  const jobs = { requireNoneRunning: vi.fn() } as unknown as JobManager;
  const writePlan = async () => {
    const path = join(cwd, "plan.md");
    await writeFile(path, "# T\n\nSteps.\n");
    return path;
  };

  it("seeds the new session with the current thinking level", async () => {
    const { ctx, newSession, newManager } = fakeCommandContext(cwd);
    const seed = vi.fn();
    const getThinkingLevel = vi.fn(() => "low" as const);
    await implementInNewSession(ctx, await writePlan(), jobs, getThinkingLevel, seed);
    expect(getThinkingLevel).toHaveBeenCalledOnce();
    expect(seed).toHaveBeenCalledWith(newManager, "low");
    expect(newSession.mock.invocationCallOrder[0]).toBeGreaterThan(getThinkingLevel.mock.invocationCallOrder[0] ?? 0);
  });

  it("starts a new session with this one as its parent, once the agent is idle", async () => {
    const { ctx, newSession, waitForIdle } = fakeCommandContext(cwd);
    await implementInNewSession(
      ctx,
      await writePlan(),
      jobs,
      () => "high",
      () => {},
    );
    expect(newSession).toHaveBeenCalledWith(expect.objectContaining({ parentSession: "/sessions/old.jsonl" }));
    expect(waitForIdle.mock.invocationCallOrder[0]).toBeLessThan(newSession.mock.invocationCallOrder[0] ?? 0);
  });

  it("sends the hand-off text, the plan's path, and the plan as the new session's first message", async () => {
    const { ctx, sendUserMessage } = fakeCommandContext(cwd);
    const path = await writePlan();
    await implementInNewSession(
      ctx,
      path,
      jobs,
      () => "high",
      () => {},
    );
    expect(sendUserMessage).toHaveBeenCalledWith(implementMessage(path, "# T\n\nSteps.\n"));
    expect(implementMessage(path, "P")).toMatch(
      /^A previous agent produced the plan below[\s\S]*\nPlan file: .*\n\nP$/,
    );
  });

  it("shows a failed first message in the new session", async () => {
    const { ctx, notify } = fakeCommandContext(cwd, { send: () => Promise.reject(new Error("no model")) });
    await implementInNewSession(
      ctx,
      await writePlan(),
      jobs,
      () => "high",
      () => {},
    );
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("no model", "error"));
  });

  it("says so when the new session is cancelled", async () => {
    const { ctx } = fakeCommandContext(cwd, { cancelled: true });
    await expect(
      implementInNewSession(
        ctx,
        await writePlan(),
        jobs,
        () => "high",
        () => {},
      ),
    ).resolves.toBe("New session cancelled; still in this one.");
  });

  it("refuses to switch sessions while a background job is running", async () => {
    const { ctx, newSession } = fakeCommandContext(cwd);
    const runningJobs = {
      requireNoneRunning: () => {
        throw new Error("Stop or wait for running jobs first: 1 (test).");
      },
    } as unknown as JobManager;
    await expect(
      implementInNewSession(
        ctx,
        await writePlan(),
        runningJobs,
        () => "high",
        () => {},
      ),
    ).rejects.toThrow("1 (test)");
    expect(newSession).not.toHaveBeenCalled();
  });

  it("fails before leaving the session when the plan can't be read", async () => {
    const { ctx, newSession } = fakeCommandContext(cwd);
    await expect(
      implementInNewSession(
        ctx,
        join(cwd, "missing.md"),
        jobs,
        () => "high",
        () => {},
      ),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(newSession).not.toHaveBeenCalled();
  });
});
