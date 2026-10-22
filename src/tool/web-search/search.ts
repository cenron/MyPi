import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "#core/util/errors";
import type { SearchBackend, SearchResult } from "./types";

/**
 * Tries the backends in order, until one answers. It moves to the next backend only when a backend is rate limited
 * or unavailable (see `canFallBack`); any other error fails at once. On failure, it throws one
 * `Web search failed (<name>): <text>` line per backend tried. A cancel is rethrown as it is.
 */
export async function searchInOrder(
  backends: SearchBackend[],
  ctx: ExtensionToolContext,
  query: string,
  signal: AbortSignal | undefined,
): Promise<{ backend: SearchBackend; results: SearchResult[] }> {
  const failures: string[] = [];
  let cause: unknown;

  for (const backend of backends) {
    try {
      return { backend, results: await backend.search(ctx, query) };
    } catch (error) {
      // The user canceled: that isn't a search failure, and pi reports it as an abort.
      if (signal?.aborted) throw error;
      failures.push(`Web search failed (${backend.name}): ${errorMessage(error)}`);
      cause = error;
      if (!canFallBack(error)) break;
    }
  }

  throw new Error(failures.join("\n"), { cause });
}

/**
 * True for errors another backend may not have: HTTP 429 (pi's MCP client says `status 429`), or the backend's tool
 * not found, which means its server is off in `/mcp` or not connected.
 */
const canFallBack = (error: unknown): boolean => {
  const message = errorMessage(error);
  return /\bstatus 429\b/.test(message) || /^Tool \S+ not found$/.test(message);
};
