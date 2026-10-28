import { textOf } from "#ui/render";
import type { SearchBackend, SearchResult } from "../types";
import { mcpBackend } from "./mcp-backend";

/** A header line of an Exa result block, such as `URL: https://…`. */
const FIELD = /^(Title|URL|Published|Author): (.*)$/;

/** Pi's name for Exa's search tool, used by the backend and web_search's rule. */
export const EXA_SEARCH_TOOL = "mcp__exa__web_search_exa";

const EXA = {
  id: "exa_search",
  name: "Exa",
  tool: EXA_SEARCH_TOOL,
  // Exa requires an objective; 10 results, as many as Parallel returns.
  argumentsForQuery: (query: string) => ({ query, objective: query, numResults: 10 }),
  parseReply: (reply: Record<string, unknown>) => parseExa(textOf(reply.content)),
};

/** Exa's free search, through its MCP server. */
export function exaBackend(): SearchBackend {
  return mcpBackend(EXA);
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
