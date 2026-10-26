import { readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { bashTool } from "#tool/bash/index";
import { JOB_NOTICE, renderNotice } from "#tool/jobs/notice";
import { fakeSession } from "../../fakes";

// Real processes, through pi's own shell.

/** A tool call's context in `cwd`, with what pi's `bash` reads for its PI_* variables. */
const toolContext = (cwd = process.cwd()) =>
  ({ cwd, sessionManager: { getSessionId: () => "s1", getSessionFile: () => undefined } }) as ExtensionToolContext;

/** A session with MyPi's `bash`; `run` calls it, and every job it starts is stopped and its log removed afterwards. */
const sessions: ReturnType<typeof fakeSession>["session"][] = [];
function newBash() {
  const fake = fakeSession();
  sessions.push(fake.session);
  const tool = bashTool(fake.session);
  const run = (params: { command: string; background?: boolean }, signal?: AbortSignal, ctx = toolContext()) =>
    tool.definition.execute("call-1", params, signal, undefined, ctx);
  return { ...fake, tool, run };
}

/** Waits for job `id` to end, and for the notice code that runs after it. */
async function ended(session: ReturnType<typeof fakeSession>["session"], id: string) {
  await session.jobs.get(id)?.done;
  await new Promise((resolve) => setImmediate(resolve));
}
afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.jobs.stopAll();
    await Promise.all(session.jobs.list().map((job) => rm(job.logPath, { force: true })));
  }
});

const textOf = (result: { content: { type: string; text?: string }[] }) => result.content[0]?.text ?? "";

describe("bash", () => {
  it("runs a foreground command as pi's bash does", async () => {
    const { session, run } = newBash();
    expect(textOf(await run({ command: "echo hi" }))).toBe("hi\n");
    expect(session.jobs.list()).toEqual([]);
  });

  it("starts a background command as a job in the call's cwd, and returns its id and log file", async () => {
    const { session, run } = newBash();
    const result = await run({ command: "pwd", background: true }, undefined, toolContext(tmpdir()));
    const [job] = session.jobs.list();
    expect(textOf(result)).toBe(
      `Started job 1 in the background: pwd\nOutput: ${job?.logPath}\nRead that file for its output; stop it with job_stop.`,
    );
    expect(result.details).toEqual({ jobId: "1", logPath: job?.logPath });

    expect(await session.jobs.get("1")?.done).toMatchObject({ kind: "shell", label: "pwd", status: "completed" });
    expect(await readFile(job?.logPath ?? "", "utf8")).toBe(`${await realpath(tmpdir())}\n`);
  });

  // The turn's signal is Escape; only a stop or the session's end ends a background job.
  it("keeps a background job running when the call is cancelled, until it's stopped", async () => {
    const { session, run } = newBash();
    const turn = new AbortController();
    await run({ command: "sleep 30", background: true }, turn.signal);
    turn.abort();
    expect(session.jobs.get("1")?.info.status).toBe("running");

    const started = Date.now();
    expect(await session.jobs.stop("1")).toMatchObject({ status: "stopped" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("tells the model when a background job ends, starting a turn if the agent is idle", async () => {
    const { session, tool, run, sendMessage, registerMessageRenderer } = newBash();
    tool.init?.();
    expect(registerMessageRenderer).toHaveBeenCalledWith(JOB_NOTICE, renderNotice);

    await run({ command: "printf 'a\\nb\\n'", background: true });
    await ended(session, "1");
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith(
      {
        customType: JOB_NOTICE,
        display: true,
        content: expect.stringMatching(
          /^Background job 1 completed \(exit code 0\) after [\d.]+s: printf .*\nLast lines:\na\nb\n/,
        ),
        details: expect.objectContaining({ tail: "a\nb" }),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  });

  // A stop is reported by whatever stopped it.
  it("sends no notice for a stopped job", async () => {
    const { session, run, sendMessage } = newBash();
    await run({ command: "sleep 30", background: true });
    await session.jobs.stop("1");
    await ended(session, "1");
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
