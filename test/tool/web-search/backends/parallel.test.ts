import { describe, expect, it } from "vitest";
import { PARALLEL_SEARCH_TOOL, parallelBackend, toResults } from "#tool/web-search/backends/parallel";
import { answered, fakeContext } from "../../fakes";

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

/** Pi's answer for a Parallel search: Parallel's reply is the MCP result's `structuredContent`. */
const parallelAnswer = (reply: unknown) => ({
  [PARALLEL_SEARCH_TOOL]: answered({ content: [], structuredContent: reply }),
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

  it("throws when the reply has no results list", () => {
    expect(() => toResults({ results: null })).toThrow("Parallel's reply has no results list.");
  });

  it("maps a recorded reply", () => {
    expect(toResults(recorded)).toEqual(
      recorded.results.map(({ url, title, excerpts }) => ({ url, title, excerpt: excerpts[0] })),
    );
  });
});

describe("parallelBackend", () => {
  it("searches with the query and the session id", async () => {
    const { ctx, executeTool } = fakeContext(parallelAnswer(recorded));
    await parallelBackend("session-1").search(ctx, "abort signal timeout");
    expect(executeTool).toHaveBeenCalledWith(PARALLEL_SEARCH_TOOL, {
      objective: "abort signal timeout",
      search_queries: ["abort signal timeout"],
      session_id: "session-1",
    });
  });

  it("reads Parallel's reply from inside the MCP result", async () => {
    const { ctx } = fakeContext(parallelAnswer(recorded));
    expect(await parallelBackend("session-1").search(ctx, "q")).toEqual(toResults(recorded));
  });
});
