import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { Session } from "#core/session";
import { jobNotice, NOTICE_LINES, noticeOnEnd } from "#tool/jobs/notice";
import { jobDuration, jobEnding } from "#tool/utils";
import { type AgentDefinition, THINKING_LEVELS } from "../agents";
import { type ChildResult, RUN_TIMEOUT_MINUTES, type RunSettings, runChild } from "../child";

/** Most background runs at once. */
const MAX_BACKGROUND = 3;

/** Most runs one user prompt may start, as a backstop for a model that delegates too eagerly. */
const MAX_PER_PROMPT = 8;

/** Most characters of the task a job's label shows: models write a whole paragraph on one line. */
const LABEL_TASK_CHARS = 60;

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
        "or sleep to wait for it. Stop it with job_stop. false waits and returns the answer.",
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

  return defineTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Hand a task to an agent that works in its own context and reports back only its answer, so the searching and " +
      "reading don't fill yours. Use it on your own when a task fits an agent in the system prompt's Subagents " +
      "list: above all `explore`, for searches of more than a few queries. The agent can't see this conversation: " +
      "give it the whole task.",
    promptSnippet: "Hand a wide search, an independent check, or a whole task to a subagent",
    parameters,
    async execute(_id, args, signal, _onUpdate, ctx) {
      const agent = findAgent(agents(), args.agent);
      const background = args.background !== false;
      requireCapacity(session, background, runsThisPrompt);
      runsThisPrompt++;

      const start = (runSignal: AbortSignal, onStep: (step: string) => void) =>
        run(ctx, agent, args.task, runSettings(agent, args), runSignal, onStep);
      if (!background) {
        const result = await start(signal ?? new AbortController().signal, () => {});
        return { content: [{ type: "text", text: formatResult(result) }], details: result };
      }
      return startJob(session, jobLabel(agent, args.task), start);
    },
  });
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
  const line = task.split("\n", 1)[0] ?? "";
  const shown = line.length > LABEL_TASK_CHARS ? `${line.slice(0, LABEL_TASK_CHARS - 1)}…` : line;
  return `${agent.name}: ${shown}`;
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
  noticeOnEnd(session, job, (ended) => {
    const notice = jobNotice(ended, job.tail(NOTICE_LINES));
    if (!result) return notice;

    const heading = `Subagent job ${ended.id} ${jobEnding(ended)} after ${jobDuration(ended)}: ${ended.label}`;
    return { ...notice, content: `${heading}\n\n${formatResult(result)}` };
  });

  const text = `Started ${label} as job ${job.info.id}. You'll get a message with the answer when it ends.`;
  return { content: [{ type: "text" as const, text }], details: { jobId: job.info.id } };
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
