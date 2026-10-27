import { describe, expect, it } from "vitest";
import { TAVILY_SEARCH_TOOL, tavilyBackend, toResults } from "#tool/web-search/tools/tavily";
import { answered, fakeContext } from "../../fakes";

describe("Tavily toResults", () => {
  it.each([
    [
      "maps its result fields",
      { url: "https://a.test", title: "A", content: "Text." },
      [{ url: "https://a.test", title: "A", excerpt: "Text." }],
    ],
    ["omits missing optional fields", { url: "https://a.test", title: "", content: null }, [{ url: "https://a.test" }]],
    ["skips entries without a URL", { title: "A", content: "Text." }, []],
  ])("%s", (_rule, entry, expected) => {
    expect(toResults({ results: [entry] })).toEqual(expected);
  });

  it("throws when the reply has no results list", () => {
    expect(() => toResults({ results: null })).toThrow("Tavily's reply has no results list.");
  });
});

describe("tavilyBackend", () => {
  it("calls Tavily with the query and maps structured content", async () => {
    const { ctx, executeTool } = fakeContext({
      [TAVILY_SEARCH_TOOL]: answered({
        structuredContent: { results: [{ url: "https://a.test", title: "A", content: "Text." }] },
      }),
    });
    await expect(tavilyBackend().search(ctx, "q")).resolves.toEqual([
      { url: "https://a.test", title: "A", excerpt: "Text." },
    ]);
    expect(executeTool).toHaveBeenCalledWith(TAVILY_SEARCH_TOOL, { query: "q" });
  });

  it("reads JSON from text when structured content is absent", async () => {
    const { ctx } = fakeContext({
      [TAVILY_SEARCH_TOOL]: answered({
        content: [{ type: "text", text: JSON.stringify({ results: [{ url: "https://a.test" }] }) }],
      }),
    });
    await expect(tavilyBackend().search(ctx, "q")).resolves.toEqual([{ url: "https://a.test" }]);
  });
});
