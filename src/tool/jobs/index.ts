import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Session } from "#core/session";
import type { Job } from "#core/types";
import type { Tool } from "#tool/types";
import { jobDuration, jobEnding } from "#tool/utils";
import { releaseNotice, reserveNotice, takeNotice } from "./notice";

/** `job_list`: every background job of this session, running or ended, oldest first, with its log file. */
export function jobListTool(session: Session): Tool {
  const definition = defineTool({
    name: "job_list",
    label: "Job list",
    description:
      "List this session's background jobs, running or ended, oldest first: id, status, how long it ran, what it is " +
      "(the command, or the agent and task), and its log file.",
    promptSnippet: "List background jobs (shell commands and subagents), with their status and log files",
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute() {
      const jobs = session.jobs.list();
      const lines = jobs.map((job) => [job.id, jobEnding(job), jobDuration(job), job.label, job.logPath].join(" · "));
      const text = jobs.length
        ? ["Background jobs in this session, oldest first:", ...lines].join("\n")
        : "No background jobs in this session.";
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  return { definition };
}

/** How long `job_wait` waits when the call gives no timeout. */
const DEFAULT_WAIT_SECONDS = 300;

/**
 * `job_wait`: waits for jobs to end and returns the text each one's notice would have carried; that notice then isn't
 * sent. A job still running at the timeout is reported, and its notice still comes. Escape stops the wait, not the jobs.
 */
export function jobWaitTool(session: Session): Tool {
  const definition = defineTool({
    name: "job_wait",
    label: "Job wait",
    description:
      "Wait for background jobs to end, up to the timeout, and return what each one's message would have said; " +
      "that message then isn't sent. Only when you can't go on without the result. Waiting doesn't stop the jobs.",
    promptSnippet: "Wait for background jobs when you can't continue without their results",
    parameters: Type.Object({
      ids: Type.Array(Type.String({ description: "Job ids, from the start message or job_list." }), { minItems: 1 }),
      timeout_seconds: Type.Optional(
        Type.Number({ minimum: 0, maximum: 1800, description: `Default ${DEFAULT_WAIT_SECONDS}.` }),
      ),
    }),
    annotations: { readOnlyHint: true },
    async execute(_id, { ids, timeout_seconds }, signal) {
      const missing = ids.filter((id) => !session.jobs.get(id));
      if (missing.length) throw new Error(`No job ${missing.join(", ")} in this session; job_list shows them.`);

      // Reserved while waiting: a job that ends now would otherwise send its notice before the wait takes it.
      const jobs = ids.flatMap((id) => session.jobs.get(id) ?? []);
      for (const job of jobs) reserveNotice(job);
      const startedAt = Date.now();
      await untilEnded(jobs, (timeout_seconds ?? DEFAULT_WAIT_SECONDS) * 1000, signal);

      const waited = Math.round((Date.now() - startedAt) / 1000);
      const text = jobs.map((job) => {
        if (job.info.status !== "running") return takeNotice(job).content;

        releaseNotice(job);
        return `${job.info.id} still running after ${waited}s: ${job.info.label}`;
      });
      return { content: [{ type: "text", text: text.join("\n\n") }], details: undefined };
    },
  });
  return { definition };
}

/** Resolves when every job has ended, `timeoutMs` has passed, or `signal` aborts; leaves no timer or listener behind. */
async function untilEnded(jobs: Job[], timeoutMs: number, signal: AbortSignal | undefined): Promise<void> {
  let stop = () => {};
  const stopped = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const onAbort = () => resolve();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) resolve();
    stop = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
  });

  try {
    await Promise.race([Promise.all(jobs.map((job) => job.done)), stopped]);
  } finally {
    stop();
  }
}

/** `job_stop`: stops a running background job and waits for it to end; its log file is kept. */
export function jobStopTool(session: Session): Tool {
  const definition = defineTool({
    name: "job_stop",
    label: "Job stop",
    description:
      "Stop a running background job (a shell command and its child processes, or a subagent), and wait for it to " +
      "end. Its log file is kept. A stopped job sends no message when it ends.",
    promptSnippet: "Stop a background job: a shell command or a subagent",
    parameters: Type.Object({
      id: Type.String({ description: "The job's id, from bash's start message or job_list." }),
    }),
    // Killing a process changes no files.
    annotations: { readOnlyHint: false, destructiveHint: false },
    async execute(_toolCallId, { id }) {
      const wasRunning = session.jobs.get(id)?.info.status === "running";
      const info = await session.jobs.stop(id);
      if (!info) throw new Error(`No job ${id} in this session; job_list shows them.`);

      // A job that exits on its own as the stop arrives keeps its exit code, so report how it actually ended.
      const text =
        wasRunning && info.status === "stopped"
          ? `Stopped job ${id} after ${jobDuration(info)}: ${info.label}\nOutput: ${info.logPath}`
          : `Job ${id} had already ended: ${jobEnding(info)}.`;
      return { content: [{ type: "text", text }], details: undefined };
    },
  });

  return { definition };
}
