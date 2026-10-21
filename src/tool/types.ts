import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

/**
 * A built-in tool: its definition, plus hooks for tools that keep state or resources across calls. `init()` runs on
 * `session_start` once every tool is registered; rebuild state from the branch there, since a `session_start` handler
 * added during `session_start` misses that session (pi snapshots the handlers first). `shutdown()` runs on
 * `session_shutdown`, which reload, a session switch, and quit all reach, so keep it idempotent.
 */
export type Tool = {
  definition: ToolDefinition;
  init?: () => void;
  shutdown?: () => void;
};
