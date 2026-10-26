import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { ToolGuard } from "#core/tool-guard";
import { planRule } from "#module/plan-build/rule";
import { registerRules, updatePromptPaths } from "#rule/index";
import type { AgentDefinition } from "./agents";

/** Installs MyPi's access rules in a child, where its normal extension is not loaded. */
export function childAccess(agent: AgentDefinition): ExtensionFactory {
  return (pi) => {
    const guard = new ToolGuard(pi);
    const prompt = registerRules(guard);
    if (agent.access === "read-only") guard.set("read-only", planRule);
    pi.on("before_agent_start", (event) => updatePromptPaths(prompt, event.systemPromptOptions));
    pi.on("tool_call", (event, context) => guard.check(event, context));
  };
}
