import { callMcpTool } from "#tool/utils";
import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";

/** Pi's name for Parallel's search tool, used by the backend and web_search's rule. */
export const PARALLEL_SEARCH_TOOL = "mcp__parallel__web_search";

/**
 * Parallel's free search, through its MCP server. `sessionId` goes with every search, as Parallel asks, for its
 * free-tier rate limits.
 */
export function parallelBackend(sessionId: string): SearchBackend {
  return {
    id: "parallel_search",
    name: "Parallel",
    tool: PARALLEL_SEARCH_TOOL,
    async search(ctx, query) {
      const call = await callMcpTool(ctx, PARALLEL_SEARCH_TOOL, {
        objective: query,
        search_queries: [query],
        session_id: sessionId,
      });
      return toResults(call.structuredContent);
    },
  };
}

/**
 * The results in Parallel's reply (the MCP result's `structuredContent`). Skips entries without a `url`, and leaves out
 * fields that are null, empty, or not strings. Throws when the reply has no `results` list.
 */
export function toResults(reply: unknown): SearchResult[] {
  return jsonResults(reply, "Parallel", "excerpts", "publish_date");
}
