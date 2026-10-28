import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  getAgentDir,
  ModelRuntime,
  resolveCliModel,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { MYPI_SESSION_MARKER_TYPE } from "#core/session-marker";
import type { ThinkingLevel } from "#core/util/thinking";
import { checksPrompt, childAccess } from "./access";
import type { AgentDefinition } from "./agents";

/** How long one run may take before it's stopped. */
export const RUN_TIMEOUT_MINUTES = 30;

/** The tools a `read-only` agent gets when its file names none. */
const READ_ONLY_TOOLS = ["read", "grep", "find", "ls", "bash"];

/** A run's model and thinking level, each undefined to inherit the parent's. */
export type RunSettings = { model?: string; thinking?: ThinkingLevel };

/** Inputs shared by every child session, bundled to keep the run contract readable. */
export type ChildRun = {
  readonly parent: ExtensionContext;
  readonly agent: AgentDefinition;
  readonly task: string;
  readonly settings: RunSettings;
  readonly signal: AbortSignal;
  readonly onStep: (step: string) => void;
  /** The project's approved check commands a read-only child may run; see `childAccess`. */
  readonly checks?: readonly string[];
};

/** What a run used over all its model calls: tokens, and cost in dollars. */
type RunUsage = { tokens: number; cost: number };

export type ChildResult = {
  answer: string;
  usage: RunUsage;
  sessionFile: string | undefined;
  changedFiles: string[];
  timedOut: boolean;
};

/**
 * Runs `task` in a new child session of `parent`: the agent's prompt and the task, not the conversation. Calls
 * `onStep` as each tool call starts. Stops when `signal` aborts or after `RUN_TIMEOUT_MINUTES`.
 */
export async function runChild(run: ChildRun, cwd = run.parent.cwd): Promise<ChildResult> {
  const { parent, agent, task, settings, signal, onStep } = run;
  if (signal.aborted) throw new Error("aborted");
  if (!settings.model && !parent.model) {
    throw new Error("No model is selected. Select one with /model, or pass `model`.");
  }

  const runtime = await ModelRuntime.create();
  if (signal.aborted) throw new Error("aborted");
  const { model, thinking } = childModel(parent, settings, runtime);
  const manager = SessionManager.create(cwd, join(subagentsDir(), "sessions"), {
    parentSession: parent.sessionManager.getSessionFile(),
  });
  manager.appendCustomEntry(MYPI_SESSION_MARKER_TYPE, {});
  const resources = await childResources(cwd, agent, run.checks ?? []);
  if (signal.aborted) throw new Error("aborted");
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    modelRuntime: runtime,
    model,
    thinkingLevel: thinking,
    tools: childTools(agent),
    resourceLoader: resources,
    sessionManager: manager,
  });

  const steps = trackSteps(session, onStep);

  let timedOut = false;
  const abort = () => void session.abort();
  const timeout = setTimeout(
    () => {
      timedOut = true;
      abort();
    },
    RUN_TIMEOUT_MINUTES * 60 * 1000,
  );
  signal.addEventListener("abort", abort, { once: true });

  try {
    if (signal.aborted) throw new Error("aborted");
    await session.prompt(task);
    return {
      answer: session.getLastAssistantText() ?? "The agent gave no answer.",
      usage: runUsage(session.messages),
      sessionFile: manager.getSessionFile(),
      changedFiles: [...steps.changedFiles],
      timedOut,
    };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    steps.stop();
    await session.dispose();
  }
}

/**
 * Reports each of the child's steps, and records each file a write or edit changed once the call succeeds. The end
 * event has no arguments, so the start keeps the path by call id.
 */
function trackSteps(session: AgentSession, onStep: (step: string) => void) {
  const pending = new Map<string, string>();
  const changedFiles = new Set<string>();
  const stop = session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      onStep(`${event.toolName}: ${JSON.stringify(event.args)}`);
      const path = changedPath(event.toolName, event.args);
      if (path) pending.set(event.toolCallId, path);
    }
    if (event.type === "tool_execution_end" && !event.isError) {
      const path = pending.get(event.toolCallId);
      if (path) changedFiles.add(path);
    }
  });
  return { changedFiles, stop };
}

/**
 * The child's model and thinking level: the parent's unless `settings` names them. pi must be given the model: left
 * to choose, it takes the first available one, which a subscription login may reject.
 */
function childModel(parent: ExtensionContext, settings: RunSettings, runtime: ModelRuntime) {
  if (!settings.model) {
    return { model: parent.model, thinking: settings.thinking ?? parent.thinkingLevel };
  }

  // `provider/id:level` names a thinking level too; an explicit `thinking` wins over it.
  const resolved = resolveCliModel({ modelRuntime: runtime, cliModel: settings.model });
  if (resolved.error || !resolved.model) {
    throw new Error(`${resolved.error ?? `No model ${settings.model}`}. Choose a model pi can use, or log in.`);
  }
  return { model: resolved.model, thinking: settings.thinking ?? resolved.thinkingLevel ?? parent.thinkingLevel };
}

/**
 * The child's prompt and context: the agent's prompt, and the project's AGENTS.md except for `explore`. No
 * extensions: MyPi loaded in a child would look for the parent's session.
 */
async function childResources(
  cwd: string,
  agent: AgentDefinition,
  checks: readonly string[],
): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    settingsManager: SettingsManager.create(cwd, getAgentDir()),
    noExtensions: true,
    noContextFiles: agent.name === "explore",
    extensionFactories: [childAccess(agent, checks)],
    systemPrompt: agent.access === "read-only" ? agent.prompt + checksPrompt(checks) : agent.prompt,
  });
  await loader.reload();
  return loader;
}

/** The file a tool call changes: the `path` of a `write` or `edit`. */
export function changedPath(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName !== "write" && toolName !== "edit") return undefined;
  return typeof args.path === "string" ? args.path : undefined;
}

/** The tokens and cost of every assistant message in `messages`. */
export function runUsage(messages: readonly { role: string }[]): RunUsage {
  const replies = messages.filter((message): message is AssistantMessage => message.role === "assistant");
  return {
    tokens: replies.reduce((sum, reply) => sum + reply.usage.totalTokens, 0),
    cost: replies.reduce((sum, reply) => sum + reply.usage.cost.total, 0),
  };
}

/** The tools a child of `agent` gets: its own list, else the read-only set, else undefined for pi's default tools. */
export function childTools(agent: AgentDefinition): string[] | undefined {
  return agent.tools ?? (agent.access === "read-only" ? READ_ONLY_TOOLS : undefined);
}

/** Subagents' own folder in pi's agent dir: their runs' sessions go in it. */
export function subagentsDir(): string {
  return join(getAgentDir(), "subagents");
}
