import { fileURLToPath } from "node:url";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { type AgentDefinition, loadAgents } from "./agents";

/** Subagents: agents the main session hands work to. Loads their definitions and lists them in the prompt. */
export class SubagentsModule extends BaseModule {
  get info(): ModuleInfo {
    return { name: "subagents", description: "Run internal agents", commands: [], loadType: ModuleLoadMode.ALWAYS };
  }

  init() {
    const builtinDir = fileURLToPath(new URL("./builtins/", import.meta.url));
    const agents = loadAgents(builtinDir, this.session.ctx.cwd, this.session.ctx.isProjectTrusted(), (message) =>
      this.session.logWarning(message),
    );
    this.setPrompt(promptSection(agents));
  }
}

/** The agent list in the prompt: when delegating pays off, then one line per agent. */
export function promptSection(agents: AgentDefinition[]): string {
  const rows = agents.map(
    (agent) =>
      `- ${agent.name}: ${agent.description} (model: ${agent.model}; thinking: ${agent.thinking}; access: ${agent.access})`,
  );
  return [
    "## Subagents",
    "Delegate wide searches, independent checks, or tasks that would flood this context; don't delegate quick lookups or one-file changes.",
    ...rows,
  ].join("\n");
}
