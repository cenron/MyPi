import { callMcpTool, textOf } from "#tool/utils";
import type { SearchBackend, SearchResult } from "../types";

/** Pi's name for Exa's search tool: `mcp__<server>__<tool>`, from `exaServer` in `src/mcp/exa.ts`. */
export const EXA_SEARCH_TOOL = "mcp__exa__web_search_exa";

/** A header line of an Exa result block, such as `URL: https://…`. */
const FIELD = /^(Title|URL|Published|Author): (.*)$/;

/** Exa's free search, through its MCP server. */
export function exaBackend(): SearchBackend {
  return {
    id: "exa_search",
    name: "Exa",
    tool: EXA_SEARCH_TOOL,
    async search(ctx, query) {
      // Exa requires an objective; the query is the best one there is. 10 results, as many as Parallel returns.
      const call = await callMcpTool(ctx, EXA_SEARCH_TOOL, { query, objective: query, numResults: 10 });
      return parseExa(textOf(call.content));
    },
  };
}

/**
 * The results in Exa's text reply: blocks of `Title:`, `URL:`, `Published:`, and `Author:` lines, then `Highlights:`
 * and the page text. `N/A` values are left out, dates are cut to YYYY-MM-DD, and a block without a URL is skipped.
 */
export function parseExa(text: string): SearchResult[] {
  // Blocks are joined with a `---` line. Page text can hold one too (a table, front matter), so a block must start
  // with its `Title:` line.
  return text.split(/\n\n---\n\n(?=Title: )/).flatMap((block): SearchResult[] => {
    const lines = block.split("\n");
    const fields: Record<string, string> = {};

    let start = 0;
    for (const line of lines) {
      const match = FIELD.exec(line);
      if (!match) break;
      const [, key = "", value = ""] = match;
      fields[key] = value.trim();
      start++;
    }

    if (lines[start] === "Highlights:") start++;

    const url = known(fields.URL);
    if (!url) return [];

    const result: SearchResult = { url };
    const title = known(fields.Title);
    if (title) result.title = title;
    const published = known(fields.Published);
    if (published) result.published = /^\d{4}-\d{2}-\d{2}/.exec(published)?.[0] ?? published;
    const excerpt = lines.slice(start).join("\n").trim();
    if (excerpt) result.excerpt = excerpt;
    return [result];
  });
}

/** A field's value, or undefined when Exa sent `N/A` or nothing. */
function known(value: string | undefined) {
  return value && value !== "N/A" ? value : undefined;
}
