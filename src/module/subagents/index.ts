import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { BaseModule } from "../base";
import { type AgentDefinition, loadAgents, projectAgentDir, userAgentDir } from "./agents";
import { agentsCmd } from "./agents-view";
import { subagentApplyTool } from "./tools/apply";
import { agentManageRule, agentManageTool } from "./tools/manage";
import { subagentTool } from "./tools/subagent";
import { recoverWriters } from "./writer";

/** Subagents: agents the main session hands work to. Loads their definitions and lists them in the prompt. */
export class SubagentsModule extends BaseModule {
  private agents: AgentDefinition[] = [];
  private builtinNames: string[] = [];
  private modelRuntime: ModelRuntime | undefined;
  private readonly modelRuntimePromise = ModelRuntime.create().then((runtime) => (this.modelRuntime = runtime));

  get info(): ModuleInfo {
    return { name: "subagents", description: "Run internal agents", commands: [], loadType: ModuleLoadMode.ALWAYS };
  }

  commands() {
    return [
      agentsCmd({
        agents: () => this.agents,
        cwd: () => this.session.ctx.cwd,
        userDir: userAgentDir,
        reload: () => this.reloadAgents(),
      }),
    ];
  }

  tools(): ToolDefinition[] {
    return [
      subagentTool(this.session, () => this.agents),
      subagentApplyTool(this.session),
      agentManageTool(this.session, this.manageCallbacks()),
    ];
  }

  init() {
    this.setWritable({
      dirs: [userAgentDir(), projectAgentDir(this.session.ctx.cwd)],
      tools: ["agent_manage"],
    });
    this.onToolCall(agentManageRule(this.manageCallbacks(), this.session.ctx.cwd));
    this.reloadAgents();
    // Not awaited: init stays synchronous, and the user is told what was recovered when it's done.
    void this.recoverWriters();
  }

  private manageCallbacks() {
    return {
      agents: () => this.agents,
      runtime: () => this.modelRuntimePromise,
      runtimeReady: () => this.modelRuntime,
      trusted: () => this.session.ctx.isProjectTrusted(),
      currentModel: () => this.session.ctx.model,
      currentThinking: () => this.session.ctx.thinkingLevel ?? "off",
      builtinNames: () => this.builtinNames,
      reload: () => this.reloadAgents(),
    };
  }

  /** Saves the work of writers a pi quit in the middle of as patches, and tells the user where they are. */
  private async recoverWriters() {
    try {
      for (const work of await recoverWriters(this.session)) {
        const what = work.patchPath
          ? `its work is saved as ${work.patchPath}; ask to apply it (subagent_apply) or drop it`
          : "it had changed nothing, so its worktree was removed";
        this.session.logWarning(`Subagents: pi closed while writer ${work.name} was running; ${what}.`);
      }
    } catch (error) {
      this.session.logWarning(`Subagents: couldn't recover writers pi closed mid-run: ${errorMessage(error)}`);
    }
  }

  private reloadAgents() {
    const builtinDir = fileURLToPath(new URL("./builtins/", import.meta.url));
    this.builtinNames = readdirSync(builtinDir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3));
    this.agents = loadAgents(builtinDir, this.session.ctx.cwd, this.session.ctx.isProjectTrusted(), (message) =>
      this.session.logWarning(message),
    );
    this.setPrompt(promptSection(this.agents));
  }
}

/** When delegating pays off. Worded like Claude Code's: a model left to judge "wide" searches on its own. */
const DELEGATION =
  "`subagent` runs one of these agents in its own context; only its answer comes back to yours. Use it without " +
  "being asked when it pays off: a search that will take more than about three queries, or spans many files or " +
  "another package (`explore`); a check that doesn't need this conversation; a whole task that would flood this " +
  "context. Do quick lookups and questions about one known file yourself. A run goes in the background: keep " +
  "working, and its answer arrives as a message. If a child reports a refused call, tell the user what it needed " +
  "and why, and offer to take that step here, where the user can approve it. Don't retry the child with the same call. " +
  "A write agent in a git project works in its own worktree, and MyPi turns its edits into a patch when it ends: ask " +
  "it for the change itself, never for a patch. Its result names the patch; apply it only with `subagent_apply`, " +
  "never `git apply` through `bash`, which wouldn't ask the user.";

/**
 * The agent list in the prompt: when delegating pays off, then one line per agent as it runs, naming the file a user
 * or project copy came from. Seen 2026-10-26: asked an edited agent's settings, a model read the builtin file instead.
 */
export function promptSection(agents: AgentDefinition[]): string {
  const rows = agents.map(
    (agent) =>
      `- ${agent.name}: ${agent.description} (model: ${agent.model}; thinking: ${agent.thinking}; ` +
      `access: ${agent.access}; ${definedBy(agent)})`,
  );
  return [
    "## Subagents",
    DELEGATION,
    "To create, change, or remove an agent, find `agent_manage` with `tool_search`.",
    "These are the agents as they run: a user or project copy replaces the builtin of the same name. Answer questions " +
      "about an agent from this list or the file it names, not from MyPi's builtin files.",
    ...rows,
  ].join("\n");
}

/** Where an agent's definition comes from, as the list says it. */
function definedBy(agent: AgentDefinition): string {
  return agent.source === "builtin" ? "builtin" : `${agent.source} copy: ${agent.path}`;
}
