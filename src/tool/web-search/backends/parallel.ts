import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";
import { mcpBackend } from "./mcp-backend";

/** Pi's name for Parallel's search tool, used by the backend and web_search's rule. */
export const PARALLEL_SEARCH_TOOL = "mcp__parallel__web_search";

export function toResults(reply: unknown): SearchResult[] {
  return jsonResults(reply, "Parallel", "excerpts", "publish_date");
}

const PARALLEL = {
  id: "parallel_search",
  name: "Parallel",
  tool: PARALLEL_SEARCH_TOOL,
  parseReply: (reply: Record<string, unknown>) => toResults(reply.structuredContent),
};

/** Parallel sends its session ID on every search, as it asks for free-tier rate limits. */
export function parallelBackend(sessionId: string): SearchBackend {
  return mcpBackend({
    ...PARALLEL,
    argumentsForQuery: (query) => ({ objective: query, search_queries: [query], session_id: sessionId }),
  });
}
