import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { formatCall, formatResult } from "#tool/web-fetch/render";
import type { FetchedDetails } from "#tool/web-fetch/types";

/** A theme that writes colors as tags, so tests can see which text got which color. */
const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `**${text}**`,
} as unknown as Theme;

/** A theme that adds nothing, for checking the words alone. */
const plain = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

const DETAILS: FetchedDetails = {
  url: "https://example.com/page",
  finalUrl: "https://example.com/page",
  status: 200,
  contentType: "text/html; charset=utf-8",
  bytes: 156_000,
  truncated: false,
  format: "markdown",
  converted: true,
  title: "Docs",
};

/** A result whose details are DETAILS with `details` over them; `null` for a result with none, as a failed call has. */
const result = (text: string, details: Partial<FetchedDetails> | null = {}): AgentToolResult<unknown> => ({
  content: [{ type: "text", text }],
  details: details === null ? undefined : { ...DETAILS, ...details },
});

describe("formatCall", () => {
  it("shows the tool and the URL, noting a request for the source", () => {
    expect(formatCall({ url: "https://example.com/" }, theme)).toBe(
      "<toolTitle>**web_fetch**</toolTitle> <accent>https://example.com/</accent>",
    );
    expect(formatCall({ url: "https://example.com/", format: "html" }, plain)).toBe(
      "web_fetch https://example.com/ (html)",
    );
    // While the model is still writing the call, the URL may be missing.
    expect(formatCall({}, plain)).toBe("web_fetch ");
  });
});

describe("formatResult", () => {
  it("collapses to the title and sizes, with the key to expand", () => {
    expect(formatResult(result("x".repeat(5_800)), false, false, plain)).toBe(
      "\nDocs · 5.7KB of markdown from 152.3KB of HTML (ctrl+o to expand)",
    );
    expect(formatResult(result("x", { title: undefined }), false, false, plain)).toMatch(
      /^\nhttps:\/\/example\.com\/page ·/,
    );
  });

  it("names what came back when nothing was converted", () => {
    const json = { converted: false, contentType: "application/json" };
    expect(formatResult(result("{}", json), false, false, plain)).toContain("· 2B of application/json");
    const untyped = { converted: false, contentType: "" };
    expect(formatResult(result("hi", untyped), false, false, plain)).toContain("· 2B of an untyped response");
  });

  it("adds where a redirect landed, the size it was cut from, and the saved file", () => {
    const details = {
      converted: false,
      contentType: "text/plain",
      truncated: true,
      bytes: 300_000,
      finalUrl: "https://example.com/moved",
      fullTextPath: "/tmp/pi-web-fetch-1.txt",
    };
    const shown = formatResult(result("x", details), false, false, plain);
    expect(shown).toContain("· 1B of text/plain, cut from 293.0KB");
    expect(shown).toContain("\n→ https://example.com/moved");
    expect(shown).toContain("\nCut to fit; full text in /tmp/pi-web-fetch-1.txt");
  });

  it("expanded, shows the text the model got, line by line", () => {
    const shown = formatResult(result("URL: https://example.com/page\n\n# Hello"), true, false, theme);
    expect(shown).toContain("<toolOutput># Hello</toolOutput>");
    expect(shown).not.toContain("to expand");
  });

  it("shows an error's text in the error color, skipping parts that aren't text", () => {
    const failed: AgentToolResult<unknown> = {
      content: [
        { type: "image", data: "", mimeType: "image/png" },
        { type: "text", text: "Unable to fetch …: HTTP 404 Not Found" },
      ],
      details: undefined,
    };
    expect(formatResult(failed, false, true, theme)).toBe("\n<error>\nUnable to fetch …: HTTP 404 Not Found</error>");
  });

  it("shows nothing for a result without details", () => {
    expect(formatResult(result("x", null), false, false, plain)).toBe("");
  });
});
