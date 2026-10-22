import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { SearchBackend, SearchResult } from "./types";

/** Pi's name for Parallel's search tool: `mcp__<server>__<tool>`, from `parallelServer` in `src/mcp/parallel.ts`. */
export const PARALLEL_SEARCH_TOOL = "mcp__parallel__web_search";

/**
 * Parallel's free search, through its MCP server. `sessionId` goes with every search, as Parallel asks, for its
 * free-tier rate limits.
 */
export function parallelBackend(sessionId: string): SearchBackend {
  return {
    id: "parallel_search",
    name: "Parallel",
    async search(ctx: ExtensionToolContext, query: string) {
      const outcome = await ctx.executeTool(PARALLEL_SEARCH_TOOL, {
        objective: query,
        search_queries: [query],
        session_id: sessionId,
      });

      if (outcome.isError) {
        const text = outcome.result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
        throw new Error(text.join("\n"));
      }

      // Pi puts the whole MCP result in `structuredContent`, so Parallel's own reply is one level down.
      const call = outcome.result.structuredContent;
      return toResults(isRecord(call) ? call.structuredContent : undefined);
    },
  };
}

/**
 * The results in Parallel's reply (the MCP result's `structuredContent`). Skips entries without a `url`, and leaves out
 * fields that are null, empty, or not strings. Throws when the reply has no `results` list.
 */
export function toResults(reply: unknown): SearchResult[] {
  if (!isRecord(reply) || !Array.isArray(reply.results)) throw new Error("Parallel's reply has no results list.");

  return reply.results.flatMap((entry): SearchResult[] => {
    if (!isRecord(entry) || typeof entry.url !== "string") return [];

    const result: SearchResult = { url: entry.url };
    if (isText(entry.title)) result.title = entry.title;

    const excerpts = Array.isArray(entry.excerpts) ? entry.excerpts.filter(isText) : [];

    if (excerpts.length > 0) result.excerpt = excerpts.join("\n\n");
    if (isText(entry.publish_date)) result.published = entry.publish_date;
    return [result];
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
