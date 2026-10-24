import type { ToolCall, ToolEnv, Verdict } from "#core/tool-guard";

/** What a rule reports about itself. `name` is the key on the guard and prefixes its questions (`<name>: …`). */
export type RuleInfo = {
  name: string;
  description: string;
};

/**
 * The skill folders and context files pi listed in the prompt, the places outside the folder pi points the agent
 * at. One per session, shared by every rule and filled by `updatePromptPaths` (`index.ts`).
 */
export type PromptPaths = { paths: readonly string[] };

/**
 * What every core rule extends: its info and its check on each tool call, with the session's prompt paths. Core rules
 * are always on; modules add theirs with `BaseModule.onToolCall`.
 */
export abstract class BaseRule {
  constructor(readonly prompt: PromptPaths) {}

  abstract get info(): RuleInfo;

  /** Allows, blocks, or asks about a call. Runs on every tool call, so keep it cheap and free of side effects. */
  abstract check(call: ToolCall, env: ToolEnv): Verdict;
}
