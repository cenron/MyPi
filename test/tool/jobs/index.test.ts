import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "#core/session";
import type { JobSpec } from "#core/types";
import { jobListTool, jobStopTool } from "#tool/jobs/index";
import { fakeSession } from "../../fakes";

/** A job that runs until it's stopped, rejecting then as pi's `exec` does. */
const server: JobSpec = {
  kind: "shell",
  label: "npm run dev",
  run: (signal) =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
};

/** A job that exits with 0 at once. */
const build: JobSpec = { kind: "shell", label: "npm test", run: async () => 0 };

/** Sessions the tests made; their jobs are stopped and their logs removed afterwards. */
const sessions: Session[] = [];
function newSession() {
  const { session } = fakeSession();
  sessions.push(session);
  return session;
}
afterEach(async () => {
  vi.useRealTimers();
  for (const session of sessions.splice(0)) {
    session.jobs.stopAll();
    await Promise.all(session.jobs.list().map((job) => rm(job.logPath, { force: true })));
  }
});

const run = async (tool: ReturnType<typeof jobListTool>, params: object = {}) => {
  const result = await tool.definition.execute("call-1", params as never, undefined, undefined, {} as never);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
};

describe("job_list", () => {
  it("lists every job, oldest first, with how it stands, how long it ran, and its log file", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const session = newSession();
    const tool = jobListTool(session);
    expect(await run(tool)).toBe("No background jobs in this session.");

    const running = session.jobs.start(server);
    const ended = session.jobs.start(build);
    await ended.done;
    vi.setSystemTime(22_000);
    expect(await run(tool)).toBe(
      [
        "Background jobs in this session, oldest first:",
        `1 · running · 12.0s · npm run dev · ${running.info.logPath}`,
        `2 · completed (exit code 0) · 0.0s · npm test · ${ended.info.logPath}`,
      ].join("\n"),
    );
  });
});

describe("job_stop", () => {
  it("stops a running job and says how long it ran", async () => {
    const session = newSession();
    const job = session.jobs.start(server);
    expect(await run(jobStopTool(session), { id: "1" })).toMatch(
      new RegExp(`^Stopped job 1 after [\\d.]+s: npm run dev\\nOutput: ${job.info.logPath}$`),
    );
    expect(job.info.status).toBe("stopped");
  });

  it("says how a job that already ended ended, and fails for an unknown id", async () => {
    const session = newSession();
    await session.jobs.start(build).done;
    // Exits with 0 just as the stop arrives; the exit code wins.
    session.jobs.start({
      ...build,
      run: (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(0))),
    });
    const tool = jobStopTool(session);
    expect(await run(tool, { id: "1" })).toBe("Job 1 had already ended: completed (exit code 0).");
    expect(await run(tool, { id: "2" })).toBe("Job 2 had already ended: completed (exit code 0).");
    await expect(run(tool, { id: "9" })).rejects.toThrow("No job 9 in this session; job_list shows them.");
  });
});

// plan-build allows a read-only tool in Plan and asks about the rest.
it("marks job_list read-only and job_stop not, so Plan allows one and asks about the other", () => {
  const session = newSession();
  expect(jobListTool(session).definition.annotations).toEqual({ readOnlyHint: true });
  expect(jobStopTool(session).definition.annotations).toEqual({ readOnlyHint: false, destructiveHint: false });
});
