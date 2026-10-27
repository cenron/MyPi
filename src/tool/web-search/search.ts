import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "#core/util/errors";
import type { SearchBackend, SearchResult } from "./types";

/** A backend stays out of the search order briefly after a rate limit. */
export const RATE_LIMIT_REST_MS = 5 * 60 * 1000;

/**
 * Said after a rate limit: on 2026-10-27 a model hit Parallel's limit and called the servers' own search tools instead,
 * which were limited too.
 */
const RATE_LIMIT_HINT = "Rate limits clear with time; don't retry the backends' own tools.";

/**
 * Tries the backends in order, until one answers. It moves to the next backend only when a backend is rate limited
 * or unavailable (see `canFallBack`); any other error fails at once. A rate-limited backend rests for five minutes,
 * unless every backend is resting, in which case they are tried in order anyway. On failure, it throws one
 * `Web search failed (<name>): <text>` line per backend tried and names any skipped backends. A cancel is rethrown.
 */
export async function searchInOrder(
  backends: SearchBackend[],
  ctx: ExtensionToolContext,
  query: string,
  signal: AbortSignal | undefined,
  restingUntil: Map<string, number> = new Map(),
  now: () => number = Date.now,
): Promise<{ backend: SearchBackend; results: SearchResult[] }> {
  const currentTime = now();
  const resting = backends.filter((backend) => (restingUntil.get(backend.id) ?? 0) > currentTime);
  const skipped = resting.length === backends.length ? [] : resting;
  const failures: string[] = [];
  let cause: unknown;
  let limited = skipped.length > 0;

  for (const backend of backends) {
    if (skipped.includes(backend)) continue;
    restingUntil.delete(backend.id);
    try {
      return { backend, results: await backend.search(ctx, query) };
    } catch (error) {
      // The user canceled: that isn't a search failure, and pi reports it as an abort.
      if (signal?.aborted) throw error;
      failures.push(`Web search failed (${backend.name}): ${errorMessage(error)}`);
      cause = error;
      if (isRateLimited(error)) {
        limited = true;
        restingUntil.set(backend.id, now() + RATE_LIMIT_REST_MS);
      }
      if (!canFallBack(error)) break;
    }
  }

  if (skipped.length > 0) {
    failures.push(`Skipped resting backends: ${skipped.map((backend) => backend.name).join(", ")}.`);
  }
  if (limited) failures.push(RATE_LIMIT_HINT);
  throw new Error(failures.join("\n"), { cause });
}

/**
 * True for rate limits, HTTP 5xx server errors, or the backend's tool not found, which means its server is off in
 * `/mcp` or not connected.
 */
function canFallBack(error: unknown): boolean {
  const message = errorMessage(error);
  return isRateLimited(error) || /\bstatus 5\d\d\b/.test(message) || /^Tool \S+ not found$/.test(message);
}

function isRateLimited(error: unknown): boolean {
  const message = errorMessage(error);
  return /\bstatus 429\b/.test(message) || /rate.?limit/i.test(message);
}
