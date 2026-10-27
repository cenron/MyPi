import { describe, expect, it } from "vitest";
import { EXA_SEARCH_TOOL, exaBackend, parseExa } from "#tool/web-search/backends/exa";
import { answered, fakeContext } from "../../fakes";

/** Exa's reply to a real search (2026-10-22), cut to shorter page text. The third holds front matter's `---` lines. */
const recorded = [
  "Title: AbortSignal: timeout() static method - Web APIs | MDN",
  "URL: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static",
  "Published: 2026-09-01T00:00:00.000Z",
  "Author: N/A",
  "Highlights:",
  "# AbortSignal: timeout() static method",
  "",
  "| Specification |",
  "| --- |",
  "",
  "---",
  "",
  "Title: AbortSignal - Web APIs | MDN",
  "URL: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal",
  "Published: 2026-09-01T00:00:00.000Z",
  "Author: N/A",
  "Highlights:",
  "## Static methods",
  "",
  "---",
  "",
  "Title: files/en-us/web/api/abortsignal/timeout_static/index.md at main · mdn/content",
  "URL: https://github.com/mdn/content/blob/main/files/en-us/web/api/abortsignal/timeout_static/index.md",
  "Published: N/A",
  "Author: N/A",
  "Highlights:",
  "---",
  'title: "AbortSignal: timeout() static method"',
  "---",
].join("\n");

/** One block of Exa's reply, from its header lines and page text. */
const block = (...lines: string[]) => lines.join("\n");

describe("parseExa", () => {
  it.each([
    [
      "keeps page text without a Highlights line",
      block("URL: https://a.test", "Text."),
      [{ url: "https://a.test", excerpt: "Text." }],
    ],
    [
      "leaves out page text that's only blank",
      block("URL: https://a.test", "Highlights:", " "),
      [{ url: "https://a.test" }],
    ],
    ["skips a block without a URL", block("Title: A", "Highlights:", "Text."), []],
    ["is empty for an empty reply", "", []],
  ])("%s", (_rule, text, expected) => {
    expect(parseExa(text)).toEqual(expected);
  });

  it("maps a recorded reply", () => {
    expect(parseExa(recorded)).toEqual([
      {
        url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static",
        title: "AbortSignal: timeout() static method - Web APIs | MDN",
        published: "2026-09-01",
        excerpt: "# AbortSignal: timeout() static method\n\n| Specification |\n| --- |",
      },
      {
        url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal",
        title: "AbortSignal - Web APIs | MDN",
        published: "2026-09-01",
        excerpt: "## Static methods",
      },
      {
        url: "https://github.com/mdn/content/blob/main/files/en-us/web/api/abortsignal/timeout_static/index.md",
        title: "files/en-us/web/api/abortsignal/timeout_static/index.md at main · mdn/content",
        excerpt: '---\ntitle: "AbortSignal: timeout() static method"\n---',
      },
    ]);
  });
});

describe("exaBackend", () => {
  const exaAnswer = { [EXA_SEARCH_TOOL]: answered({ content: [{ type: "text", text: recorded }] }) };

  it("searches with the query as the objective, for 10 results", async () => {
    const { ctx, executeTool } = fakeContext(exaAnswer);
    await exaBackend().search(ctx, "abort signal timeout");
    expect(executeTool).toHaveBeenCalledWith(EXA_SEARCH_TOOL, {
      query: "abort signal timeout",
      objective: "abort signal timeout",
      numResults: 10,
    });
  });

  // The model's copy may be cut at 20 KB; the MCP result pi keeps is whole.
  it("reads the whole text from the MCP result, not the model's copy", async () => {
    const { ctx } = fakeContext(exaAnswer);
    expect(await exaBackend().search(ctx, "q")).toEqual(parseExa(recorded));
  });
});
