import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";
import { mcpBackend } from "./mcp-backend";

/** Pi's name for TinyFish's search tool. */
export const TINYFISH_SEARCH_TOOL = "mcp__tinyfish__search";

/** Parses TinyFish's JSON text and maps its snippet field to a common excerpt. */
export function toResults(text: string): SearchResult[] {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new Error("TinyFish's reply is not valid JSON.");
  }

  return jsonResults(reply, "TinyFish", "snippet");
}

const TINYFISH = {
  id: "tinyfish_search",
  name: "TinyFish",
  tool: TINYFISH_SEARCH_TOOL,
  argumentsForQuery: (query: string) => ({ query }),
  parseReply: (reply: Record<string, unknown>) => toResults(textOf(reply.content)),
};

/** TinyFish's search MCP returns JSON in its text content. */
export function tinyfishBackend(): SearchBackend {
  return mcpBackend(TINYFISH);
}
