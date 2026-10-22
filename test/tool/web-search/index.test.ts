import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { formatResults } from "#tool/web-search/format";
import { webSearchTool } from "#tool/web-search/index";
import { PARALLEL_SEARCH_TOOL } from "#tool/web-search/parallel";
import { fakeSession } from "../../fakes";

const reply = { results: [{ url: "https://a.test", title: "A", publish_date: null, excerpts: ["Some text."] }] };

/** A `ctx` whose `executeTool` answers like pi does for an MCP tool: the whole MCP result as `structuredContent`. */
function fakeContext(isError = false, text = "") {
  const result = isError
    ? { content: [{ type: "text", text }] }
    : {
        content: [{ type: "text", text: JSON.stringify(reply) }],
        structuredContent: { content: [], structuredContent: reply },
      };
  const executeTool = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    toolCall: {},
    result,
    isError,
  }));
  return { ctx: { executeTool } as unknown as ExtensionToolContext, executeTool };
}

describe("webSearchTool", () => {
  const { definition } = webSearchTool(fakeSession().session);
  const run = (ctx: ExtensionToolContext, signal?: AbortSignal) =>
    definition.execute("call-1", { query: "q" }, signal, undefined, ctx);

  it("returns the formatted results, and keeps them in details", async () => {
    const result = await run(fakeContext().ctx);
    const results = [{ url: "https://a.test", title: "A", excerpt: "Some text." }];
    expect(result.content).toEqual([{ type: "text", text: formatResults("q", "Parallel", results) }]);
    expect(result.details).toEqual({ query: "q", backend: "parallel_search", results });
  });

  it("names the backend when a search fails", async () => {
    const { ctx } = fakeContext(true, `Tool ${PARALLEL_SEARCH_TOOL} not found`);
    await expect(run(ctx)).rejects.toThrow(`Web search failed (Parallel): Tool ${PARALLEL_SEARCH_TOOL} not found`);
  });

  it("passes a cancel through as it is", async () => {
    const { ctx } = fakeContext(true, "Aborted");
    await expect(run(ctx, AbortSignal.abort())).rejects.toThrow(/^Aborted$/);
  });

  it("sends the same session id with every search", async () => {
    const { ctx, executeTool } = fakeContext();
    await run(ctx);
    await run(ctx);
    const [first, second] = executeTool.mock.calls.map(([, args]) => args.session_id);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  it("reaches Parallel's tool, so pi waits for the server", () => {
    expect(definition.reachesTools?.({ query: "q" })).toEqual([PARALLEL_SEARCH_TOOL]);
  });
});
