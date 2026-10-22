import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { searchInOrder } from "#tool/web-search/search";
import type { SearchBackend } from "#tool/web-search/types";

const RATE_LIMITED = "MCP HTTP request failed with status 429: Too Many Requests";
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

  // The fallback rules: only a rate limit or a missing tool sends the search on to the next backend.
  it.each([
    [RATE_LIMITED, true],
    ["MCP HTTP request failed with status 429", true],
    ["Tool mcp__parallel__web_search not found", true],
    ["MCP HTTP request failed with status 500: Internal Server Error", false],
    ["Parallel's reply has no results list.", false],
  ])("after %s, asks the next backend: %s", async (message, fallsBack) => {
    const second = backend("Second");
    const search = searchInOrder([backend("First", message), second], ctx, "q", undefined);
    if (fallsBack) await expect(search).resolves.toEqual({ backend: second, results });
    else await expect(search).rejects.toThrow(new Error(`Web search failed (First): ${message}`));
    expect(second.search).toHaveBeenCalledTimes(fallsBack ? 1 : 0);
  });

  it("lists every backend it tried when none could answer", async () => {
    const backends = [backend("First", RATE_LIMITED), backend("Second", "boom")];
    await expect(searchInOrder(backends, ctx, "q", undefined)).rejects.toThrow(
      new Error(`Web search failed (First): ${RATE_LIMITED}\nWeb search failed (Second): boom`),
    );
  });

  it("passes a cancel through as it is", async () => {
    const second = backend("Second");
    await expect(searchInOrder([backend("First", "Aborted"), second], ctx, "q", AbortSignal.abort())).rejects.toThrow(
      /^Aborted$/,
    );
    expect(second.search).not.toHaveBeenCalled();
  });
});
