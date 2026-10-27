import type { ToolCall, ToolRule } from "#core/tool-guard";
import type { SearchBackend } from "./types";

/** Restricts provider search calls to web_search, which owns backend fallback and rate-limit rests. */
export function createSearchBackendsRule(backends: readonly SearchBackend[]): ToolRule {
  const backendTools = new Set(backends.map((backend) => backend.tool));

  return function checkSearchBackend({ toolName, parentToolName }: ToolCall) {
    if (!backendTools.has(toolName)) return { kind: "allow" };
    if (parentToolName === "web_search") return { kind: "allow" };

    return {
      kind: "block",
      reason:
        "Use web_search: it tries the next search service when one fails and rests ones that hit their limit. " +
        "Don't call the services' own tools.",
    };
  };
}
