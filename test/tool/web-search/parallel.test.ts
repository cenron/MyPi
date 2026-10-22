import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PARALLEL_SEARCH_TOOL, parallelBackend, toResults } from "#tool/web-search/parallel";

/** Parallel's reply to a real search (2026-10-21), cut to 3 results with shorter excerpts and placeholder ids. */
const recorded = {
  search_id: "search_0",
  results: [
    {
      url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static",
      title: "AbortSignal: timeout() static method - Web APIs | MDN",
      publish_date: null,
      excerpts: ["The AbortSignal.timeout() static method returns an AbortSignal that will automatically abort"],
    },
    {
      url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal",
      title: "AbortSignal - Web APIs | MDN",
      publish_date: null,
      excerpts: ["The AbortSignal interface represents a signal object"],
    },
    {
      url: "https://github.com/nodejs/node/blob/0e6db9c3b06214db5d0868a5296560f786d77c00/doc/api/timers.md",
      title: "node/doc/api/timers.md at 0e6db9c3b06214db5d0868a5296560f786d77c00 · nodejs/node · GitHub",
      publish_date: null,
      excerpts: ["const ac = new AbortController();\nconst signal = ac.signal;"],
    },
  ],
  warnings: null,
  metadata: null,
  session_id: "session-0",
};

/** A `ctx` whose `executeTool` returns `result`, the way pi returns an MCP tool's result. */
function fakeContext(
  result: { content: { type: "text"; text: string }[]; structuredContent?: unknown },
  isError = false,
) {
  const executeTool = vi.fn(async () => ({ toolCall: {}, result, isError }));
  return { ctx: { executeTool } as unknown as ExtensionToolContext, executeTool };
}

/** Pi's result for an MCP call: the whole MCP result, minus `_meta`, is its `structuredContent`. */
const mcpResult = (reply: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(reply) }],
  structuredContent: { content: [{ type: "text", text: JSON.stringify(reply) }], structuredContent: reply },
});

describe("toResults", () => {
  const entry = { url: "https://a.test", title: "A", publish_date: "2026-01-02", excerpts: ["one"] };

  it.each([
    ["keeps every field", entry, [{ url: "https://a.test", title: "A", published: "2026-01-02", excerpt: "one" }]],
    [
      "leaves out a null title and date",
      { ...entry, title: null, publish_date: null },
      [{ url: "https://a.test", excerpt: "one" }],
    ],
    [
      "leaves out empty excerpts",
      { ...entry, excerpts: [""] },
      [{ url: "https://a.test", title: "A", published: "2026-01-02" }],
    ],
    [
      "joins several excerpts",
      { ...entry, excerpts: ["one", "two"] },
      [{ url: "https://a.test", title: "A", published: "2026-01-02", excerpt: "one\n\ntwo" }],
    ],
    ["skips an entry without a url", { ...entry, url: null }, []],
  ])("%s", (_rule, input, expected) => {
    expect(toResults({ results: [input] })).toEqual(expected);
  });

  it.each([undefined, {}, { results: null }])("throws when the reply has no results list: %j", (reply) => {
    expect(() => toResults(reply)).toThrow("Parallel's reply has no results list.");
  });

  it("maps a recorded reply", () => {
    expect(toResults(recorded)).toEqual(
      recorded.results.map(({ url, title, excerpts }) => ({ url, title, excerpt: excerpts[0] })),
    );
  });
});

describe("parallelBackend", () => {
  it("searches with the query and the session id", async () => {
    const { ctx, executeTool } = fakeContext(mcpResult(recorded));
    await parallelBackend("session-1").search(ctx, "abort signal timeout");
    expect(executeTool).toHaveBeenCalledWith(PARALLEL_SEARCH_TOOL, {
      objective: "abort signal timeout",
      search_queries: ["abort signal timeout"],
      session_id: "session-1",
    });
  });

  it("reads Parallel's reply from inside the MCP result", async () => {
    const { ctx } = fakeContext(mcpResult(recorded));
    expect(await parallelBackend("session-1").search(ctx, "q")).toEqual(toResults(recorded));
  });

  it("throws an error result's text", async () => {
    const { ctx } = fakeContext({ content: [{ type: "text", text: `Tool ${PARALLEL_SEARCH_TOOL} not found` }] }, true);
    await expect(parallelBackend("session-1").search(ctx, "q")).rejects.toThrow(
      `Tool ${PARALLEL_SEARCH_TOOL} not found`,
    );
  });
});
