import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "#core/util/errors";
import type { SearchBackend, SearchResult } from "./types";

/** A backend stays out of the search order briefly after a rate limit. */
export const RATE_LIMIT_REST_MS = 5 * 60 * 1000;
/** The longest rest a limit message can ask for, so a garbled number can't park a backend for a day. */
export const MAX_RATE_LIMIT_REST_MS = 60 * 60 * 1000;

/** Milliseconds per unit a limit message may name; a number with no unit is seconds. */
const UNIT_MS: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000 };

/** What `searchInOrder` keeps between searches, and where this search starts in the list. */
export type SearchOptions = {
  /** When each resting backend may be tried again, by backend id. */
  restingUntil?: Map<string, number>;
  now?: () => number;
  /** The backend this search asks first; the rest follow in list order, wrapping around. */
  startIndex?: number;
};

/**
 * Said after a rate limit: on 2026-10-27 a model hit Parallel's limit and called the servers' own search tools instead,
 * which were limited too.
 */
const RATE_LIMIT_HINT = "Rate limits clear with time; don't retry the backends' own tools.";

/**
 * Tries the backends in order, until one answers. It moves to the next backend only when a backend is rate limited
 * or unavailable (see `canFallBack`); any other error fails at once. A rate-limited backend rests for the delay in
 * its message, or five minutes when none is stated, capped at one hour. If every backend is resting, all are tried
 * in order anyway. On failure, it throws one
 * `Web search failed (<name>): <text>` line per backend tried and names any skipped backends. A cancel is rethrown.
 */
export async function searchInOrder(
  backends: SearchBackend[],
  ctx: ExtensionToolContext,
  query: string,
  signal: AbortSignal | undefined,
  { restingUntil = new Map(), now = Date.now, startIndex = 0 }: SearchOptions = {},
): Promise<{ backend: SearchBackend; results: SearchResult[] }> {
  const currentTime = now();
  const start = startIndex % backends.length;
  const order = [...backends.slice(start), ...backends.slice(0, start)];
  const resting = order.filter((backend) => (restingUntil.get(backend.id) ?? 0) > currentTime);
  const skipped = resting.length === order.length ? [] : resting;
  const failures: string[] = [];
  let cause: unknown;
  let limited = skipped.length > 0;

  for (const backend of order) {
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
        restingUntil.set(backend.id, now() + restFor(errorMessage(error), now()));
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

/** Uses a retry delay or reset timestamp from a limit message, with a bounded default when it gives none. */
export function restFor(message: string, now: number): number {
  const delay = message.match(
    /\b(?:retry after|try again in)\s+(\d+(?:\.\d+)?)\s*(h|hours?|m|mins?|minutes?|s|secs?|seconds?)?\b/i,
  );
  if (delay?.[1]) {
    const unitMs = UNIT_MS[(delay[2] ?? "s").charAt(0).toLowerCase()] ?? 1000;
    return Math.min(Number(delay[1]) * unitMs, MAX_RATE_LIMIT_REST_MS);
  }

  const reset = message.match(/\b(?:reset(?:s)?(?: time)?(?: at)?|retry at)\s+(\d{10,13})\b/i);
  if (reset?.[1]) {
    const timestamp = Number(reset[1]) * (reset[1].length === 10 ? 1000 : 1);
    return Math.min(Math.max(timestamp - now, 0), MAX_RATE_LIMIT_REST_MS);
  }

  return RATE_LIMIT_REST_MS;
}

function isRateLimited(error: unknown): boolean {
  const message = errorMessage(error);
  return /\bstatus 429\b/.test(message) || /rate.?limit/i.test(message);
}
