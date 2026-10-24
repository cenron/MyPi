import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { BaseRule, PromptPaths } from "./base";
import { FolderRule } from "./folder";

/**
 * Sets MyPi's own tool rules on the session's guard, next to the modules' rules, by `info.name`. Always on: they're
 * not a module. Returns the prompt paths the rules share, for `updatePromptPaths`.
 */
export function registerRules(session: Session): PromptPaths {
  const prompt: PromptPaths = { paths: [] };
  for (const rule of createRules(prompt)) session.toolGuard.set(rule.info.name, (call, env) => rule.check(call, env));
  return prompt;
}

/**
 * Fills the rules' prompt paths from a run's prompt, once: pi only re-reads skills and context files on `/reload`,
 * which starts a new session with new rules. A prompt that listed none leaves them empty for the next run to fill.
 */
export function updatePromptPaths(prompt: PromptPaths, { skills, contextFiles }: NormalizedBuildSystemPromptOptions) {
  if (prompt.paths.length > 0) return;
  prompt.paths = [...skills.map((skill) => skill.baseDir), ...contextFiles.map((file) => file.path)];
}

/** MyPi's own tool rules. Add new ones here. */
function createRules(prompt: PromptPaths): BaseRule[] {
  return [new FolderRule(prompt)];
}
