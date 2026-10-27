import { describe, expect, it } from "vitest";
import { TINYFISH_SEARCH_TOOL, tinyfishBackend, toResults } from "#tool/web-search/tools/tinyfish";
import { answered, fakeContext } from "../../fakes";

describe("TinyFish toResults", () => {
  it.each([
    [
      "maps its result fields",
      { url: "https://a.test", title: "A", snippet: "Text." },
      [{ url: "https://a.test", title: "A", excerpt: "Text." }],
    ],
    ["omits missing optional fields", { url: "https://a.test", title: "", snippet: null }, [{ url: "https://a.test" }]],
    ["skips entries without a URL", { title: "A", snippet: "Text." }, []],
  ])("%s", (_rule, entry, expected) => {
    expect(toResults(JSON.stringify({ query: "q", results: [entry] }))).toEqual(expected);
  });

  it("throws when the reply cannot be read", () => {
    expect(() => toResults("not json")).toThrow("TinyFish's reply is not valid JSON.");
    expect(() => toResults(JSON.stringify({ results: null }))).toThrow("TinyFish's reply has no results list.");
  });
});

describe("tinyfishBackend", () => {
  it("calls TinyFish search with the query and maps its text reply", async () => {
    const { ctx, executeTool } = fakeContext({
      [TINYFISH_SEARCH_TOOL]: answered({
        content: [
          {
            type: "text",
            text: JSON.stringify({ results: [{ url: "https://a.test", title: "A", snippet: "Text." }] }),
          },
        ],
      }),
    });
    await expect(tinyfishBackend().search(ctx, "q")).resolves.toEqual([
      { url: "https://a.test", title: "A", excerpt: "Text." },
    ]);
    expect(executeTool).toHaveBeenCalledWith(TINYFISH_SEARCH_TOOL, { query: "q" });
  });
});
