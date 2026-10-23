import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { formatCall, formatResult } from "#tool/web-search/render";
import type { SearchResult } from "#tool/web-search/types";

/** A theme that writes colors as tags, so tests can see which text got which color. */
const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `**${text}**`,
} as unknown as Theme;

const MDN: SearchResult = {
  url: "https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal",
  title: "AbortSignal - Web APIs | MDN",
  published: "2026-09-01",
  excerpt: "The AbortSignal interface.\nIt has static methods.",
};
const BARE: SearchResult = { url: "https://www.example.com/page" };

/** A search's result as pi passes it to the renderer, with `results` from Parallel. */
const searched = (results: SearchResult[]): AgentToolResult<unknown> => ({
  content: [{ type: "text", text: "the model's text" }],
  details: { query: "q", backend: { id: "parallel_search", name: "Parallel" }, results },
});

describe("formatCall", () => {
  it("shows the tool and the query", () => {
    expect(formatCall({ query: "node fetch" }, theme)).toBe(
      '<toolTitle>**web_search**</toolTitle> <accent>"node fetch"</accent>',
    );
  });
});

describe("formatResult", () => {
  it("lists each result's title and site when collapsed", () => {
    expect(formatResult(searched([MDN, BARE]), false, false, theme)).toBe(
      [
        "",
        "**2 results** <muted>from Parallel</muted>",
        "AbortSignal - Web APIs | MDN<muted> · developer.mozilla.org</muted>",
        "https://www.example.com/page<muted> · example.com</muted> <dim>(ctrl+o to expand)</dim>",
      ].join("\n"),
    );
  });

  it("shows each result's title, URL, date, and excerpt when expanded", () => {
    expect(formatResult(searched([MDN, BARE]), true, false, theme)).toBe(
      [
        "",
        "**2 results** <muted>from Parallel</muted>",
        "",
        "**AbortSignal - Web APIs | MDN**",
        "<accent>https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal</accent>",
        "<dim>Published: 2026-09-01</dim>",
        "<toolOutput>The AbortSignal interface.</toolOutput>",
        "<toolOutput>It has static methods.</toolOutput>",
        "",
        "<accent>https://www.example.com/page</accent>",
      ].join("\n"),
    );
  });

  it("says so when there are no results", () => {
    expect(formatResult(searched([]), false, false, theme)).toBe("\n<muted>No results from Parallel</muted>");
  });

  it("shows an error's text in the error color", () => {
    const failed = { content: [{ type: "text" as const, text: "Web search failed (Parallel): boom" }], details: {} };
    expect(formatResult(failed, false, true, theme)).toBe("\n<error>Web search failed (Parallel): boom</error>");
  });
});
