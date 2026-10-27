import { isNonEmptyString, isRecord } from "#core/util/guards";
import { callMcpTool } from "#tool/utils";
import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";

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

  if (!isRecord(reply) || !Array.isArray(reply.results)) throw new Error("TinyFish's reply has no results list.");

  return reply.results.flatMap((entry): SearchResult[] => {
    if (!isRecord(entry) || typeof entry.url !== "string") return [];

    const result: SearchResult = { url: entry.url };
    if (isNonEmptyString(entry.title)) result.title = entry.title;
    if (isNonEmptyString(entry.snippet)) result.excerpt = entry.snippet;
    return [result];
  });
}
