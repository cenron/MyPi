import { fileURLToPath } from "node:url";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { type AgentDefinition, loadAgents } from "./agents";
import { subagentTool } from "./tools/subagent";

/** Subagents: agents the main session hands work to. Loads their definitions and lists them in the prompt. */
export class SubagentsModule extends BaseModule {
  private agents: AgentDefinition[] = [];

  get info(): ModuleInfo {
    return { name: "subagents", description: "Run internal agents", commands: [], loadType: ModuleLoadMode.ALWAYS };
  }

  tools(): ToolDefinition[] {
    return [subagentTool(this.session, () => this.agents)];
  }

  init() {
    const builtinDir = fileURLToPath(new URL("./builtins/", import.meta.url));
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
  "and why, and offer to take that step here, where the user can approve it. Don't retry the child with the same call.";

/** The agent list in the prompt: when delegating pays off, then one line per agent. */
export function promptSection(agents: AgentDefinition[]): string {
  const rows = agents.map(
    (agent) =>
      `- ${agent.name}: ${agent.description} (model: ${agent.model}; thinking: ${agent.thinking}; access: ${agent.access})`,
  );
  return ["## Subagents", DELEGATION, ...rows].join("\n");
}
