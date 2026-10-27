import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolRule } from "#core/tool-guard";

/**
 * A built-in tool: its definition, plus hooks for tools that keep state or resources across calls. `init()` runs on
 * `session_start` once every tool is registered; rebuild state from the branch there, since a `session_start` handler
 * added during `session_start` misses that session (pi snapshots the handlers first). `shutdown()` runs on
 * `session_shutdown`, which reload, a session switch, and quit all reach, so keep it idempotent. `rule` is the tool's
 * own rule on every tool call, set on the guard under the tool's name (a module's `onToolCall`, for a built-in tool).
 */
export type Tool = {
  definition: ToolDefinition;
  rule?: ToolRule;
  init?: () => void;
  shutdown?: () => void;
};
