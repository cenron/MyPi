import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { restFor, searchInOrder } from "#tool/web-search/search";
import type { SearchBackend } from "#tool/web-search/types";

const RATE_LIMITED = "MCP HTTP request failed with status 429: Too Many Requests";
const PARALLEL_RATE_LIMITED =
  "Web search failed (Parallel): You've hit the free-tier rate limit for Parallel Search MCP";
const results = [{ url: "https://a.test" }];
const ctx = {} as ExtensionToolContext;

/** A backend named `name` that answers with `results`, or fails with `error` when given one. */
function backend(name: string, error?: string): SearchBackend & { search: ReturnType<typeof vi.fn> } {
  const search = vi.fn(async () => {
    if (error) throw new Error(error);
    return results;
  });
  return { id: name.toLowerCase(), name, tool: `mcp__${name}`, search };
}

describe("searchInOrder", () => {
  it("returns the first backend's answer, without asking the next", async () => {
    const first = backend("First");
    const second = backend("Second");
    expect(await searchInOrder([first, second], ctx, "q", undefined)).toEqual({ backend: first, results });
    expect(first.search).toHaveBeenCalledWith(ctx, "q");
    expect(second.search).not.toHaveBeenCalled();
  });

  // The fallback rules: rate limits, server errors, and a missing tool move on; other errors stop at once.
  it.each([
    [PARALLEL_RATE_LIMITED, true],
    ["MCP HTTP request failed with status 429: You've hit the free MCP rate limit for Exa", true],
    ["MCP HTTP request failed with status 503: Service Unavailable", true],
    ["Tool mcp__x__y not found", true],
    ["Parallel's reply has no results list.", false],
  ])("after %s, asks the next backend: %s", async (message, fallsBack) => {
    const second = backend("Second");
    const search = searchInOrder([backend("First", message), second], ctx, "q", undefined);
    if (fallsBack) await expect(search).resolves.toEqual({ backend: second, results });
    else await expect(search).rejects.toThrow(new Error(`Web search failed (First): ${message}`));
    expect(second.search).toHaveBeenCalledTimes(fallsBack ? 1 : 0);
  });

  it("lists failures and resting backends when none could answer", async () => {
    const first = backend("First");
    const restingUntil = new Map([[first.id, 10_000]]);
    const backends = [first, backend("Second", "boom")];
    await expect(searchInOrder(backends, ctx, "q", undefined, { restingUntil, now: () => 1 })).rejects.toThrow(
      new Error(
        "Web search failed (Second): boom\n" +
          "Skipped resting backends: First.\n" +
          "Rate limits clear with time; don't retry the backends' own tools.",
      ),
    );
    expect(backends[0]?.search).not.toHaveBeenCalled();
  });

  it("says rate limits clear with time when every backend was limited", async () => {
    const backends = [
      backend("First", PARALLEL_RATE_LIMITED),
      backend("Second", "MCP HTTP request failed with status 429"),
    ];
    await expect(searchInOrder(backends, ctx, "q", undefined)).rejects.toThrow(
      new Error(
        `Web search failed (First): ${PARALLEL_RATE_LIMITED}\n` +
          "Web search failed (Second): MCP HTTP request failed with status 429\n" +
          "Rate limits clear with time; don't retry the backends' own tools.",
      ),
    );
  });

  it("skips a rate-limited backend until its rest expires", async () => {
    let now = 1_000;
    const restingUntil = new Map<string, number>();
    const first = backend("First", RATE_LIMITED);
    const second = backend("Second");
    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    first.search.mockImplementation(async () => results);

    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    expect(first.search).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000;
    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    expect(first.search).toHaveBeenCalledTimes(2);
  });

  it("tries all backends when every backend is resting", async () => {
    const first = backend("First");
    const second = backend("Second");
    const restingUntil = new Map([
      [first.id, 10_000],
      [second.id, 10_000],
    ]);

    await expect(searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => 1 })).resolves.toEqual({
      backend: first,
      results,
    });
    expect(first.search).toHaveBeenCalledTimes(1);
    expect(second.search).not.toHaveBeenCalled();
  });

  it.each([
    [PARALLEL_RATE_LIMITED, 5 * 60 * 1000],
    ["MCP HTTP request failed with status 429: You've hit the free MCP rate limit for Exa", 5 * 60 * 1000],
    ["rate limited; retry after 60", 60 * 1000],
    ["rate limited; reset time 1700000060", 60 * 1000],
    ["rate limited; retry after 999999", 60 * 60 * 1000],
    ["rate limited; try again in 5 minutes", 5 * 60 * 1000],
    ["rate limited; retry after 2 hours", 60 * 60 * 1000],
    ["rate limited; try again in 30s", 30 * 1000],
    ["nonsense", 5 * 60 * 1000],
  ])("rests according to the limit message %s", (message, expected) => {
    expect(restFor(message, 1_700_000_000_000)).toBe(expected);
  });

  it("rotates the starting backend and still falls through in order", async () => {
    const first = backend("First");
    const second = backend("Second", "MCP HTTP request failed with status 503");
    const third = backend("Third");

    expect((await searchInOrder([first, second, third], ctx, "q", undefined, { startIndex: 1 })).backend).toBe(third);
    expect(first.search).not.toHaveBeenCalled();
    expect(second.search).toHaveBeenCalledTimes(1);
    expect(third.search).toHaveBeenCalledTimes(1);
  });

  it("skips a resting backend in its rotated turn and uses it after expiry", async () => {
    let now = 1_000;
    const restingUntil = new Map<string, number>();
    const first = backend("First", RATE_LIMITED);
    const second = backend("Second");
    const third = backend("Third");
    const backends = [first, second, third];

    await searchInOrder(backends, ctx, "q", undefined, { restingUntil, now: () => now });
    first.search.mockImplementation(async () => results);
    await searchInOrder(backends, ctx, "q", undefined, { restingUntil, now: () => now, startIndex: 0 });
    expect(first.search).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000;
    await searchInOrder(backends, ctx, "q", undefined, { restingUntil, now: () => now, startIndex: 0 });
    expect(first.search).toHaveBeenCalledTimes(2);
  });

  it("skips a resting backend after the rotated start and reaches the next backend", async () => {
    const first = backend("First");
    const second = backend("Second");
    const third = backend("Third");
    const restingUntil = new Map([[first.id, 10_000]]);

    const result = await searchInOrder([first, second, third], ctx, "q", undefined, {
      restingUntil,
      now: () => 1,
      startIndex: 2,
    });
    expect(result.backend).toBe(third);
    expect(first.search).not.toHaveBeenCalled();
  });

  it("skips a backend until its stated reset time, then uses it again", async () => {
    let now = 1_700_000_000_000;
    const restingUntil = new Map<string, number>();
    const first = backend("First", "rate limit; retry after 60 seconds");
    const second = backend("Second");
    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    first.search.mockImplementation(async () => results);

    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    expect(first.search).toHaveBeenCalledTimes(1);
    now += 60_000;
    await searchInOrder([first, second], ctx, "q", undefined, { restingUntil, now: () => now });
    expect(first.search).toHaveBeenCalledTimes(2);
  });

  it("passes a cancel through as it is", async () => {
    const second = backend("Second");
    await expect(searchInOrder([backend("First", "Aborted"), second], ctx, "q", AbortSignal.abort())).rejects.toThrow(
      /^Aborted$/,
    );
    expect(second.search).not.toHaveBeenCalled();
  });
});
