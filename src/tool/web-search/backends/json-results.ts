import { isNonEmptyString, isRecord } from "#core/util/guards";
import type { SearchResult } from "../types";

/** Maps the shared JSON search-result shape, with each service's excerpt and date field names. */
export function jsonResults(
  reply: unknown,
  source: string,
  excerptField: string,
  publishedField?: string,
): SearchResult[] {
  if (!isRecord(reply) || !Array.isArray(reply.results)) throw new Error(`${source}'s reply has no results list.`);

  return reply.results.flatMap((entry): SearchResult[] => {
    if (!isRecord(entry) || typeof entry.url !== "string") return [];

    const result: SearchResult = { url: entry.url };
    if (isNonEmptyString(entry.title)) result.title = entry.title;
    const excerpt = entry[excerptField];
    if (isNonEmptyString(excerpt)) result.excerpt = excerpt;
    if (Array.isArray(excerpt)) {
      const parts = excerpt.filter(isNonEmptyString);
      if (parts.length > 0) result.excerpt = parts.join("\n\n");
    }
    if (publishedField && isNonEmptyString(entry[publishedField])) result.published = entry[publishedField];
    return [result];
  });
}
