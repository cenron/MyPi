import { callMcpTool } from "#tool/utils";
import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";

/** Pi's name for Tavily's search tool. */
export const TAVILY_SEARCH_TOOL = "mcp__tavily__tavily_search";

/** Tavily's keyed search MCP; it is registered only when `TAVILY_API_KEY` is set. */
export function tavilyBackend(): SearchBackend {
  return {
    id: "tavily_search",
    name: "Tavily",
    tool: TAVILY_SEARCH_TOOL,
    async search(ctx, query) {
      const call = await callMcpTool(ctx, TAVILY_SEARCH_TOOL, { query });
      return toResults(call.structuredContent ?? parseReply(textOf(call.content)));
    },
  };
}

/** Maps Tavily's `{ results: [{ title, url, content }] }` reply; unlike Parallel, Tavily returns one `content` string. */
export function toResults(reply: unknown): SearchResult[] {
  return jsonResults(reply, "Tavily", "content");
}

/** Parses the JSON-text form used by MCP servers that don't send structured content. */
function parseReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Tavily's reply is not valid JSON.");
  }
}
