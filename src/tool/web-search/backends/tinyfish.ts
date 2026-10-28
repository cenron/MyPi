import { callMcpTool } from "#tool/utils";
import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";
import { jsonResults } from "./json-results";

/** Pi's name for TinyFish's search tool. */
export const TINYFISH_SEARCH_TOOL = "mcp__tinyfish__search";

/** TinyFish's search MCP returns JSON in its text content. */
export function tinyfishBackend(): SearchBackend {
  return {
    id: "tinyfish_search",
    name: "TinyFish",
    tool: TINYFISH_SEARCH_TOOL,
    async search(ctx, query) {
      const call = await callMcpTool(ctx, TINYFISH_SEARCH_TOOL, { query });
      return toResults(textOf(call.content));
    },
  };
}

/** Maps TinyFish's `{ results: [{ url, title, snippet }] }` text reply to the common result shape. */
export function toResults(text: string): SearchResult[] {
  let reply: unknown;
  try {
    reply = JSON.parse(text);
  } catch {
    throw new Error("TinyFish's reply is not valid JSON.");
  }

  return jsonResults(reply, "TinyFish", "snippet");
}
