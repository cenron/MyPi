import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Session } from "#core/session";
import type { Tool } from "#tool/types";
import { jobDuration, jobEnding } from "#tool/utils";

/** `job_list`: every background job of this session, running or ended, oldest first, with its log file. */
export function jobListTool(session: Session): Tool {
  const definition = defineTool({
    name: "job_list",
    label: "Job list",
    description:
      "List this session's background jobs, running or ended, oldest first: id, status, how long it ran, the " +
      "command, and its log file.",
    promptSnippet: "List the background jobs bash started, with their status and log files",
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

/** `job_stop`: stops a running background job and waits for it to end; its log file is kept. */
export function jobStopTool(session: Session): Tool {
  const definition = defineTool({
    name: "job_stop",
    label: "Job stop",
    description:
      "Stop a running background job and its child processes, and wait for it to end. Its log file is kept. A " +
      "stopped job sends no message when it ends.",
    promptSnippet: "Stop a background job bash started",
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
