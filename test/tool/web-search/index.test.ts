import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { formatResults } from "#tool/web-search/format";
import { webSearchTool } from "#tool/web-search/index";
import { EXA_SEARCH_TOOL } from "#tool/web-search/tools/exa";
import { PARALLEL_SEARCH_TOOL } from "#tool/web-search/tools/parallel";
import { fakeSession } from "../../fakes";
import { answered, failed, fakeContext } from "./fakes";

const results = [{ url: "https://a.test", title: "A", excerpt: "Some text." }];

/** Each backend's answer with `results`, as pi returns it. */
const parallel = answered({
  content: [],
  structuredContent: { results: [{ url: "https://a.test", title: "A", publish_date: null, excerpts: ["Some text."] }] },
});
const exa = answered({ content: [{ type: "text", text: "Title: A\nURL: https://a.test\nHighlights:\nSome text." }] });

describe("webSearchTool", () => {
  const { definition } = webSearchTool(fakeSession().session);
  const run = (ctx: ExtensionToolContext, signal?: AbortSignal) =>
    definition.execute("call-1", { query: "q" }, signal, undefined, ctx);

  it("returns Parallel's results, and keeps them in details", async () => {
    const result = await run(fakeContext({ [PARALLEL_SEARCH_TOOL]: parallel, [EXA_SEARCH_TOOL]: exa }).ctx);
    expect(result.content).toEqual([{ type: "text", text: formatResults("q", "Parallel", results) }]);
    expect(result.details).toEqual({ query: "q", backend: "parallel_search", results });
  });

  it("asks Exa when Parallel can't answer", async () => {
    const result = await run(fakeContext({ [EXA_SEARCH_TOOL]: exa }).ctx);
    expect(result.content).toEqual([{ type: "text", text: formatResults("q", "Exa", results) }]);
    expect(result.details).toEqual({ query: "q", backend: "exa_search", results });
  });

  it("names each backend when the search fails", async () => {
    await expect(run(fakeContext().ctx)).rejects.toThrow(
      new Error(
        `Web search failed (Parallel): Tool ${PARALLEL_SEARCH_TOOL} not found\n` +
          `Web search failed (Exa): Tool ${EXA_SEARCH_TOOL} not found`,
      ),
    );
  });

  it("passes a cancel through as it is", async () => {
    const { ctx } = fakeContext({ [PARALLEL_SEARCH_TOOL]: failed("Aborted") });
    await expect(run(ctx, AbortSignal.abort())).rejects.toThrow(/^Aborted$/);
  });

  it("sends the same Parallel session id with every search", async () => {
    const { ctx, executeTool } = fakeContext({ [PARALLEL_SEARCH_TOOL]: parallel });
    await run(ctx);
    await run(ctx);
    const [first, second] = executeTool.mock.calls.map(([, args]) => args.session_id);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  it("reaches every backend's tool, so pi waits for their servers", () => {
    expect(definition.reachesTools?.({ query: "q" })).toEqual([PARALLEL_SEARCH_TOOL, EXA_SEARCH_TOOL]);
  });
});
