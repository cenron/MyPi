import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXA_SEARCH_TOOL } from "#tool/web-search/backends/exa";
import { PARALLEL_SEARCH_TOOL } from "#tool/web-search/backends/parallel";
import { TAVILY_SEARCH_TOOL } from "#tool/web-search/backends/tavily";
import { TINYFISH_SEARCH_TOOL } from "#tool/web-search/backends/tinyfish";
import { formatResults } from "#tool/web-search/format";
import { webSearchTool } from "#tool/web-search/index";
import type { SearchDetails } from "#tool/web-search/types";
import { answered, fakeContext } from "../fakes";

const results = [{ url: "https://a.test", title: "A", excerpt: "Some text." }];

/** Each backend's answer with `results`, as pi returns it. */
const parallel = answered({
  content: [],
  structuredContent: { results: [{ url: "https://a.test", title: "A", publish_date: null, excerpts: ["Some text."] }] },
});
const exa = answered({ content: [{ type: "text", text: "Title: A\nURL: https://a.test\nHighlights:\nSome text." }] });

describe("webSearchTool", () => {
  let definition: ReturnType<typeof webSearchTool>["definition"];
  beforeEach(() => {
    vi.stubEnv("TAVILY_API_KEY", "");
    definition = webSearchTool().definition;
  });
  afterEach(() => vi.unstubAllEnvs());

  const run = (ctx: ExtensionToolContext, signal?: AbortSignal) =>
    definition.execute("call-1", { query: "q" }, signal, undefined, ctx);

  it("returns Parallel's results, and keeps them in details", async () => {
    const result = await run(fakeContext({ [PARALLEL_SEARCH_TOOL]: parallel, [EXA_SEARCH_TOOL]: exa }).ctx);
    expect(result.content).toEqual([{ type: "text", text: formatResults("q", "Parallel", results) }]);
    expect(result.details).toEqual({ query: "q", backend: { id: "parallel_search", name: "Parallel" }, results });
  });

  it("asks Exa when Parallel can't answer", async () => {
    const result = await run(fakeContext({ [EXA_SEARCH_TOOL]: exa }).ctx);
    expect(result.content).toEqual([{ type: "text", text: formatResults("q", "Exa", results) }]);
    expect(result.details).toEqual({ query: "q", backend: { id: "exa_search", name: "Exa" }, results });
  });

  it("falls through to TinyFish after Parallel and Exa are unavailable", async () => {
    const tinyfish = answered({
      content: [
        { type: "text", text: JSON.stringify({ results: [{ url: "https://tinyfish.test", title: "TinyFish" }] }) },
      ],
    });
    const result = await run(fakeContext({ [TINYFISH_SEARCH_TOOL]: tinyfish }).ctx);
    expect(result.details).toEqual({
      query: "q",
      backend: { id: "tinyfish_search", name: "TinyFish" },
      results: [{ url: "https://tinyfish.test", title: "TinyFish" }],
    });
  });

  it("adds Tavily last only when its key is set", () => {
    vi.stubEnv("TAVILY_API_KEY", "key");
    const keyed = webSearchTool().definition;
    expect(keyed.reachesTools?.({ query: "q" })).toEqual([
      PARALLEL_SEARCH_TOOL,
      EXA_SEARCH_TOOL,
      TINYFISH_SEARCH_TOOL,
      TAVILY_SEARCH_TOOL,
    ]);
  });

  it("rotates the starting backend across searches", async () => {
    const tinyfish = answered({
      content: [
        { type: "text", text: JSON.stringify({ results: [{ url: "https://tinyfish.test", title: "TinyFish" }] }) },
      ],
    });
    const { ctx } = fakeContext({
      [PARALLEL_SEARCH_TOOL]: parallel,
      [EXA_SEARCH_TOOL]: exa,
      [TINYFISH_SEARCH_TOOL]: tinyfish,
    });

    const answers = [];
    for (let index = 0; index < 3; index++) {
      const result = await run(ctx);
      answers.push((result.details as SearchDetails | undefined)?.backend.name);
    }
    expect(answers).toEqual(["Parallel", "Exa", "TinyFish"]);
  });

  it("sends the Parallel session id when Parallel is its turn", async () => {
    const { ctx, executeTool } = fakeContext({ [PARALLEL_SEARCH_TOOL]: parallel });
    await run(ctx);
    await run(ctx);
    const sessionIds = executeTool.mock.calls.map(([, args]) => args.session_id);
    expect(sessionIds.filter((sessionId) => sessionId !== undefined)).toEqual([expect.any(String), expect.any(String)]);
  });

  it("reaches every backend's tool, so pi waits for their servers", () => {
    expect(definition.reachesTools?.({ query: "q" })).toEqual([
      PARALLEL_SEARCH_TOOL,
      EXA_SEARCH_TOOL,
      TINYFISH_SEARCH_TOOL,
    ]);
  });
});
