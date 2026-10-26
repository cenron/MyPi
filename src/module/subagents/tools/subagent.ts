import { defineTool, type Theme } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { ask } from "#core/events";
import type { Session } from "#core/session";
import { jobNotice, NOTICE_LINES, NoticeGroup, noticeOnEnd } from "#tool/jobs/notice";
import { expandKey, jobDuration, jobEnding, reuseText, textOf } from "#tool/utils";
import { type AgentDefinition, THINKING_LEVELS } from "../agents";
import { type ChildResult, RUN_TIMEOUT_MINUTES, type RunSettings, runChild } from "../child";

/** Most background runs at once. */
const MAX_BACKGROUND = 3;

/** Most runs one user prompt may start, as a backstop for a model that delegates too eagerly. */
const MAX_PER_PROMPT = 8;

/** Most characters of the task a job's label and a call's line show: models write a whole paragraph on one line. */
const LABEL_TASK_CHARS = 60;

/** Quiet period before successful subagent notices are grouped. */
const GROUP_WAIT_MS = 3_000;

/** Most of the child's steps a foreground call shows while it runs, until expanded. */
const PROGRESS_LINES = 5;

/** Most characters of a foreground answer shown until expanded. */
const PREVIEW_CHARS = 500;

const parameters = Type.Object({
  agent: Type.String({ description: "The agent's name, from the list in the system prompt." }),
  task: Type.String({
    description: "The whole task: the agent sees this, not the conversation, so include the paths and facts it needs.",
  }),
  model: Type.Optional(Type.String({ description: "A model for this run only, as `provider/id`." })),
  thinking: Type.Optional(
    Type.Union(
      THINKING_LEVELS.map((level) => Type.Literal(level)),
      { description: "A thinking level for this run only." },
    ),
  ),
  background: Type.Optional(
    Type.Boolean({
      description:
        "Default true: return at once with a job id. You'll get a message with the answer when it ends; don't poll " +
        "or sleep to wait for it; use job_wait only when you can't go on without the result. Stop it with job_stop. " +
        "false waits and returns the answer.",
    }),
  ),
});

type RunArgs = Static<typeof parameters>;

/**
 * `subagent`: hands a task to one of `agents()` in a child session. Background runs are jobs in `session.jobs`, so
 * `job_list` and `job_stop` work on them; `run` is the child runner, replaced in tests.
 */
export function subagentTool(session: Session, agents: () => AgentDefinition[], run = runChild) {
  // Only a prompt the user sends starts a new count: a job notice's turn mustn't, or each could start more runs.
  let runsThisPrompt = 0;
  session.pi.on("input", (event) => {
    if (event.source !== "extension") runsThisPrompt = 0;
  });
  /** `write` runs going now, foreground or background: one at a time until parallel writers get worktrees. */
  let writeRuns = 0;
  const noticeGroup = new NoticeGroup(session, GROUP_WAIT_MS);

  return defineTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Hand a task to an agent that works in its own context and reports back only its answer, so the searching and " +
      "reading don't fill yours. Use it on your own when a task fits an agent in the system prompt's Subagents " +
      "list: above all `explore`, for searches of more than a few queries. The agent can't see this conversation: " +
      "give it the whole task.",
    promptSnippet: "Hand a wide search, an independent check, or a whole task to a subagent",
    // In Plan, execute refuses write agents; calls that reach planRule only run read-only agents.
    annotations: { readOnlyHint: true },
    parameters,
    renderCall(args, theme, context) {
      const title = theme.fg("toolTitle", theme.bold(`subagent ${args.agent ?? "..."}`));
      return reuseText(context.lastComponent, `${title} ${theme.fg("muted", taskStart(args.task ?? "..."))}`);
    },
    renderResult(result, { expanded }, theme, context) {
      const details = result.details as { jobId?: string; steps?: string[] } | undefined;
      if (!context.isPartial && details?.jobId) {
        return reuseText(context.lastComponent, `\n${theme.fg("muted", `started as job ${details.jobId}`)}`);
      }
      if (details?.steps) {
        return reuseText(context.lastComponent, formatProgress(details.steps, expanded, theme));
      }
      const output = textOf(result.content);
      return reuseText(context.lastComponent, formatOutput(output, expanded, theme));
    },
    async execute(_id, args, signal, onUpdate, ctx) {
      const agent = findAgent(agents(), args.agent);
      const writes = agent.access === "write";
      if (writes && (await isPlanMode(session))) {
        throw new Error(`Plan mode is on: ${agent.name} can change files. Switch to Build, or use a read-only agent.`);
      }
      if (writes && writeRuns > 0) {
        throw new Error("Only one write subagent runs at a time; wait for the other to end.");
      }

      const background = args.background !== false;
      requireCapacity(session, background, runsThisPrompt);
      runsThisPrompt++;

      // Counted from here until the run ends, however it ends.
      if (writes) writeRuns++;
      const start = (runSignal: AbortSignal, onStep: (step: string) => void) =>
        run(ctx, agent, args.task, runSettings(agent, args), runSignal, onStep).finally(() => {
          if (writes) writeRuns--;
        });

      if (!background) {
        const steps: string[] = [];
        const result = await start(signal ?? new AbortController().signal, (step) => {
          steps.push(step);
          // Drawn by `renderResult` from `details`; partial results don't reach the model.
          onUpdate?.({ content: [], details: { steps } });
        });
        return { content: [{ type: "text", text: formatResult(result) }], details: result };
      }
      return startJob(session, jobLabel(agent, args.task), start, noticeGroup);
    },
  });
}

/** Whether plan-build says Plan is on. With plan-build off, nobody answers, which counts as Build. */
async function isPlanMode(session: Session): Promise<boolean> {
  const answers = await ask(session.pi.events, "mode", undefined);
  return answers.some((answer) => answer.kind === "answer" && answer.value === "plan");
}

function findAgent(agents: AgentDefinition[], name: string): AgentDefinition {
  const agent = agents.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`No agent '${name}'. Agents: ${agents.map((candidate) => candidate.name).join(", ")}.`);
  }
  return agent;
}

function requireCapacity(session: Session, background: boolean, runsThisPrompt: number): void {
  if (runsThisPrompt >= MAX_PER_PROMPT) {
    throw new Error(`At most ${MAX_PER_PROMPT} subagent runs per prompt; do the rest yourself.`);
  }

  const running = session.jobs.list().filter((job) => job.kind === "subagent" && job.status === "running");
  if (background && running.length >= MAX_BACKGROUND) {
    throw new Error(`At most ${MAX_BACKGROUND} background subagents at once; wait for one to end.`);
  }
}

/** The agent and the start of the task's first line, for `job_list`, the footer, and notices. */
function jobLabel(agent: AgentDefinition, task: string): string {
  return `${agent.name}: ${taskStart(task)}`;
}

/** The start of the task's first line, at most `LABEL_TASK_CHARS` characters. */
function taskStart(task: string): string {
  const line = task.split("\n", 1)[0] ?? "";
  return line.length > LABEL_TASK_CHARS ? `${line.slice(0, LABEL_TASK_CHARS - 1)}…` : line;
}

/** The run's model and thinking level: the call's, else the agent's; `inherit` leaves them to the parent's. */
function runSettings(agent: AgentDefinition, args: RunArgs): RunSettings {
  const model = args.model ?? agent.model;
  const thinking = args.thinking ?? agent.thinking;
  return {
    model: model === "inherit" ? undefined : model,
    thinking: thinking === "inherit" ? undefined : thinking,
  };
}

/**
 * Starts the run as a job: its steps go to the job's log, and when it ends a notice brings the whole result in and
 * wakes the main agent.
 */
function startJob(
  session: Session,
  label: string,
  start: (signal: AbortSignal, onStep: (step: string) => void) => Promise<ChildResult>,
  group: NoticeGroup,
) {
  let result: ChildResult | undefined;
  const job = session.jobs.start({
    kind: "subagent",
    label,
    run: async (signal, write) => {
      result = await start(signal, (step) => write(`${step}\n`));
      return 0;
    },
  });

  // A failed run has no result: its notice is a shell job's, with the error and the last steps.
  noticeOnEnd(
    session,
    job,
    (ended) => {
      const notice = jobNotice(ended, job.tail(NOTICE_LINES));
      if (!result) return notice;

      const heading = `Subagent job ${ended.id} ${jobEnding(ended)} after ${jobDuration(ended)}: ${ended.label}`;
      return { ...notice, content: `${heading}\n\n${formatResult(result)}` };
    },
    group,
  );

  const text = `Started ${label} as job ${job.info.id}. You'll get a message with the answer when it ends.`;
  return { content: [{ type: "text" as const, text }], details: { jobId: job.info.id } };
}

/** A running foreground call's steps: the last few, or all of them when expanded. */
function formatProgress(steps: string[], expanded: boolean, theme: Theme): string {
  const visible = expanded ? steps : steps.slice(-PROGRESS_LINES);
  const lines = visible.map((step) => `  ${step}`).join("\n");
  if (expanded || steps.length <= PROGRESS_LINES) return `\n${lines}`;

  const hint = theme.fg("dim", `(${expandKey()} to expand)`);
  return `\n… ${steps.length - PROGRESS_LINES} earlier steps\n${lines} ${hint}`;
}

/** A finished foreground call's text: its start, or all of it when expanded. */
function formatOutput(output: string, expanded: boolean, theme: Theme): string {
  if (expanded || output.length <= PREVIEW_CHARS) return `\n${output}`;
  return `\n${output.slice(0, PREVIEW_CHARS)}… ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
}

/** The model's text for a result: the answer, then usage, the session file, and the files the run changed. */
function formatResult(result: ChildResult): string {
  return [
    result.timedOut ? `Stopped at the ${RUN_TIMEOUT_MINUTES}-minute limit; the answer may be incomplete.` : undefined,
    result.answer,
    `Usage: ${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`,
    `Session: ${result.sessionFile ?? "not saved"}`,
    `Changed files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "none"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
