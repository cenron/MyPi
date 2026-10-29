import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { answeredItems, ask } from "#core/events";
import { planRule } from "#core/plan-rule";
import type { Session } from "#core/session";
import { ToolGuard, type ToolRule } from "#core/tool-guard";
import { isReadOnlyCommandWithChecks } from "#core/util/shell";
import { registerRules, updatePromptPaths } from "#rule/index";
import type { AgentDefinition } from "./agents";

/**
 * What a read-only child's prompt adds: read with tools for the open-ended shapes its shell guard refuses, rather than
 * writing a loop or a pipeline it can't run.
 */
export const READ_ONLY_PROMPT =
  "\n\nRead with the `read`, `grep`, `find`, and `ls` tools, one call at a time: bash refuses `for …; do …; done`, `xargs`, and `$(…)`. Do those as separate calls, and report anything you couldn't run.";

/**
 * Installs MyPi's access rules in a child, where its normal extension is not loaded. A read-only child gets Plan's
 * rule, plus `checks`: the project's check commands the user approved.
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

/** Plan's rule, except that approved checks may run as segments alongside readers. */
function readOnlyRule(checks: readonly string[]): ToolRule {
  return (call, context) => {
    if (
      call.toolName === "bash" &&
      typeof call.input.command === "string" &&
      isReadOnlyCommandWithChecks(call.input.command, checks, context.cwd)
    ) {
      return { kind: "allow" };
    }
    return planRule(call, context);
  };
}

/** The prompt line that tells a read-only child which checks it may run; empty when there are none. */
export function checksPrompt(checks: readonly string[]): string {
  if (checks.length === 0) return "";
  const list = checks.map((command) => `\`${command}\``).join(", ");
  return `\n\nYou may run the project's checks with bash, each as written, alone or after a \`cd\` inside the project and chained with read-only commands; a check may take extra file names (no other flags) and a leading \`TZ=\`; no output redirects: ${list}.`;
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
