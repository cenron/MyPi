import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";
import { mcpBackend } from "./mcp-backend";

/** Pi's name for Tavily's search tool. */
export const TAVILY_SEARCH_TOOL = "mcp__tavily__tavily_search";

/** Maps the structured-content form of Tavily's reply. */
export function toResults(reply: unknown): SearchResult[] {
  return jsonResults(reply, "Tavily", "content");
}

const TAVILY = {
  id: "tavily_search",
  name: "Tavily",
  tool: TAVILY_SEARCH_TOOL,
  argumentsForQuery: (query: string) => ({ query }),
  parseReply: (reply: Record<string, unknown>) =>
    toResults(reply.structuredContent ?? parseReply(textOf(reply.content))),
};

/** Tavily's keyed search MCP; it is registered only when `TAVILY_API_KEY` is set. */
export function tavilyBackend(): SearchBackend {
  return mcpBackend(TAVILY);
}

/** Parses the JSON-text form used by MCP servers that don't send structured content. */
function parseReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Tavily's reply is not valid JSON.");
  }
}
