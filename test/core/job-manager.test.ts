import { readFile, rm, stat } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { JobManager, shellJob } from "#core/job-manager";
import type { JobSpec } from "#core/types";

/** Log files the tests made, removed after each test. */
const logs: string[] = [];
afterEach(async () => {
  await Promise.all(logs.splice(0).map((path) => rm(path, { force: true })));
});

/**
 * A job whose `run` the test drives: `write` sends output, `end` resolves with an exit code, `fail` rejects. Stopping
 * it rejects, as pi's `exec` does when its signal aborts.
 */
function controlled(label = "job") {
  let write!: (chunk: Buffer | string) => void;
  let end!: (code: number) => void;
  let fail!: (error: Error) => void;
  const spec: JobSpec = {
    kind: "test",
    label,
    run: (signal, out) =>
      new Promise<number>((resolve, reject) => {
        write = out;
        end = resolve;
        fail = reject;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  };
  return {
    spec,
    write: (chunk: Buffer | string) => write(chunk),
    end: (code: number) => end(code),
    fail: (e: Error) => fail(e),
  };
}

/** Starts `spec` and remembers its log for cleanup. */
function start(jobs: JobManager, spec: JobSpec) {
  const job = jobs.start(spec);
  logs.push(job.info.logPath);
  return job;
}

describe("JobManager", () => {
  it("counts ids up from 1 and lists jobs oldest first", () => {
    const jobs = new JobManager();
    start(jobs, controlled("first").spec);
    start(jobs, controlled("second").spec);
    expect(jobs.list().map(({ id, label, status }) => ({ id, label, status }))).toEqual([
      { id: "1", label: "first", status: "running" },
      { id: "2", label: "second", status: "running" },
    ]);
    expect(jobs.get("2")?.info.label).toBe("second");
    expect(jobs.get("3")).toBeUndefined();
  });

  it("writes output to the log file and keeps its last lines, a character split across chunks whole", async () => {
    const jobs = new JobManager();
    const run = controlled();
    const job = start(jobs, run.spec);
    const euro = Buffer.from("€\n");
    run.write("one\ntwo\n");
    run.write(euro.subarray(0, 1));
    run.write(euro.subarray(1));
    run.end(0);
    await job.done;

    expect(job.tail(2)).toBe("two\n€");
    expect(await readFile(job.info.logPath, "utf8")).toBe("one\ntwo\n€\n");
    expect((await stat(job.info.logPath)).mode & 0o777).toBe(0o600);
  });

  it("drops output written after the job ended", async () => {
    const jobs = new JobManager();
    const run = controlled();
    const job = start(jobs, run.spec);
    run.write("kept\n");
    run.end(0);
    await job.done;
    run.write("late\n");
    expect(job.tail(5)).toBe("kept");
    expect(await readFile(job.info.logPath, "utf8")).toBe("kept\n");
  });

  it("keeps only the last 50K characters in memory", async () => {
    const jobs = new JobManager();
    const run = controlled();
    const job = start(jobs, run.spec);
    run.write(`start\n${"x".repeat(60_000)}`);
    run.end(0);
    await job.done;
    expect(job.tail(10)).toBe("x".repeat(51_200));
  });

  it.each([
    ["exit code 0 is completed", (r: ReturnType<typeof controlled>) => r.end(0), { status: "completed", exitCode: 0 }],
    ["another exit code is failed", (r: ReturnType<typeof controlled>) => r.end(3), { status: "failed", exitCode: 3 }],
    [
      "a run that throws is failed",
      (r: ReturnType<typeof controlled>) => r.fail(new Error("boom")),
      { status: "failed", error: "boom" },
    ],
  ])("%s", async (_rule, finish, expected) => {
    const jobs = new JobManager();
    const run = controlled();
    const job = start(jobs, run.spec);
    finish(run);
    const info = await job.done;
    expect(info).toMatchObject(expected);
    expect(info.endedAt).toEqual(expect.any(Number));
  });

  it("stops a running job and waits for it to end", async () => {
    const jobs = new JobManager();
    const job = start(jobs, controlled().spec);
    const info = await jobs.stop("1");
    expect(info).toMatchObject({ status: "stopped" });
    expect(info).not.toHaveProperty("exitCode");
    expect(info).not.toHaveProperty("error");
    expect(job.info.status).toBe("stopped");
  });

  it("returns an ended job as it is, and undefined for an unknown id", async () => {
    const jobs = new JobManager();
    const run = controlled();
    start(jobs, run.spec);
    run.end(0);
    expect(await jobs.stop("1")).toMatchObject({ status: "completed", exitCode: 0 });
    expect(await jobs.stop("9")).toBeUndefined();
  });

  it("stops every running job, and a second call is harmless", async () => {
    const jobs = new JobManager();
    const done = [start(jobs, controlled().spec), start(jobs, controlled().spec)].map((job) => job.done);
    jobs.stopAll();
    jobs.stopAll();
    expect((await Promise.all(done)).map((info) => info.status)).toEqual(["stopped", "stopped"]);
  });
});

// Real processes, through pi's own shell.
describe("shellJob", () => {
  it("runs a command to the end, with its output", async () => {
    const job = start(new JobManager(), shellJob("printf 'a\\nb\\n'", process.cwd()));
    expect(await job.done).toMatchObject({
      kind: "shell",
      label: "printf 'a\\nb\\n'",
      status: "completed",
      exitCode: 0,
    });
    expect(job.tail(5)).toBe("a\nb");
    expect(await readFile(job.info.logPath, "utf8")).toBe("a\nb\n");
  });

  it("stops a command that would run on", async () => {
    const jobs = new JobManager();
    const job = start(jobs, shellJob("sleep 30", process.cwd()));
    const started = Date.now();
    expect(await jobs.stop(job.info.id)).toMatchObject({ status: "stopped" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
