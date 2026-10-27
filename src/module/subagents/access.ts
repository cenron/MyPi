import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { answeredItems, ask } from "#core/events";
import { planRule } from "#core/plan-rule";
import type { Session } from "#core/session";
import { ToolGuard, type ToolRule } from "#core/tool-guard";
import { registerRules, updatePromptPaths } from "#rule/index";
import type { AgentDefinition } from "./agents";

/**
 * Installs MyPi's access rules in a child, where its normal extension is not loaded. A read-only child gets Plan's
 * rule, plus `checks`: the project's check commands the user approved, run exactly as written.
 */
export function childAccess(agent: AgentDefinition, checks: readonly string[] = []): ExtensionFactory {
  return (pi) => {
    const guard = new ToolGuard(pi);
    const prompt = registerRules(guard);
    if (agent.access === "read-only") guard.set("read-only", readOnlyRule(checks));
    pi.on("before_agent_start", (event) => updatePromptPaths(prompt, event.systemPromptOptions));
    pi.on("tool_call", (event, context) => guard.check(event, context));
  };
}

/** Plan's rule, except that an approved check command, exactly as written, runs without asking. */
export function readOnlyRule(checks: readonly string[]): ToolRule {
  return (call, context) => {
    if (call.toolName === "bash" && checks.includes(String(call.input.command).trim())) return { kind: "allow" };
    return planRule(call, context);
  };
}

/** The prompt line that tells a read-only child which checks it may run; empty when there are none. */
export function checksPrompt(checks: readonly string[]): string {
  if (checks.length === 0) return "";
  const list = checks.map((command) => `\`${command}\``).join(", ");
  return `\n\nYou may run the project's checks with bash, each exactly as written, with nothing added (no pipes, redirects, or extra arguments): ${list}.`;
}

/**
 * The project's check commands the user already approved, from the done check over the bus; none when it's off. A
 * failed answer is shown to the user, and the child runs without checks.
 */
export async function approvedChecks(session: Session): Promise<string[]> {
  const answers = await ask(session.pi.events, "checkCommands", undefined);
  return answeredItems(answers, (from, error) =>
    session.logWarning(`Subagents: ${from} couldn't list the project's checks: ${error}`),
  );
}
