import {
  type BashToolDetails,
  createBashToolDefinition,
  createLocalBashOperations,
  defineTool,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Session } from "#core/session";
import type { JobSpec } from "#core/types";
import { JOB_NOTICE, noticeOnEnd, renderNotice } from "#tool/jobs/notice";
import type { Tool } from "#tool/types";

/**
 * What a background start returns: the job's id and the file its output goes to. Built on pi's details, whose fields
 * are all optional, so pi's renderer still takes the result.
 */
export type BackgroundDetails = BashToolDetails & { jobId: string; logPath: string };

/**
 * pi's `bash` plus `background: true`, which starts the command as a job in `session.jobs` and returns at once with
 * its id and log file. Without it, the call is pi's own `bash`, unchanged.
 */
export function bashTool(session: Session): Tool {
  const piBash = createBashToolDefinition(session.ctx.cwd);
  // Built on pi's own parameters, so they match the `piBash` that runs the calls; pi doesn't export its schema.
  const parameters = Type.Object({
    ...piBash.parameters.properties,
    background: Type.Optional(
      Type.Boolean({
        description:
          "Run the command in the background and return at once with a job id and a log file. For dev servers, " +
          "watchers, and anything that doesn't exit. The timeout doesn't apply. You'll get a message when it ends; " +
          "don't poll or sleep to wait for it. Stop it with job_stop.",
      }),
    ),
  });

  // Spreads pi's definition for its prompt text and `outputSchema`. It has no renderer: pi draws `bash` with its
  // built-in one because this supplies none, and `backgroundRenderer` (registered in `MyPi`) draws background calls.
  const definition = defineTool({
    ...piBash,
    parameters,
    description:
      `${piBash.description} Set background to true for a command that keeps running, such as a dev server or a ` +
      "watcher; read its log file for the output.",
    async execute(toolCallId, { command, timeout, background }, signal, onUpdate, ctx) {
      if (!background) return piBash.execute(toolCallId, { command, timeout }, signal, onUpdate, ctx);

      // The turn's signal isn't passed on, so Escape doesn't stop the job; `job_stop` and session end do.
      const job = session.jobs.start(shellJob(command, ctx.cwd));
      noticeOnEnd(session, job);

      const { info } = job;
      const text =
        `Started job ${info.id} in the background: ${command}\nOutput: ${info.logPath}\n` +
        "Read that file for its output; stop it with job_stop.";
      const details: BackgroundDetails = { jobId: info.id, logPath: info.logPath };
      return {
        content: [{ type: "text", text }],
        details,
        // pi's bash declares an `outputSchema`, so codemode scripts read this instead of the text.
        structuredContent: { output: text, truncated: false, exit_code: 0, wall_time_seconds: 0 },
      };
    },
  });

  return {
    definition,
    init: () => session.pi.registerMessageRenderer(JOB_NOTICE, renderNotice),
  };
}

/** A job that runs `command` in `cwd` through pi's own shell, with no time limit. */
function shellJob(command: string, cwd: string): JobSpec {
  return {
    kind: "shell",
    label: command,
    // pi kills the whole process tree when `signal` aborts. A null exit code is a failed command, as in pi's bash.
    run: async (signal, write) =>
      (await createLocalBashOperations().exec(command, cwd, { onData: write, signal })).exitCode ?? 1,
  };
}
