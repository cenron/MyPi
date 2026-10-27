import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { callMcpTool, siteOf } from "#tool/utils";
import { answered, failed, fakeContext } from "./fakes";

describe("callMcpTool", () => {
  it("returns the whole MCP result", async () => {
    const call = { content: [{ type: "text", text: "the full text" }], structuredContent: { results: [] } };
    const { ctx, executeTool } = fakeContext({ search: answered(call) });
    expect(await callMcpTool(ctx, "search", { query: "q" })).toEqual(call);
    expect(executeTool).toHaveBeenCalledWith("search", { query: "q" });
  });

  it("throws an error outcome's text", async () => {
    const { ctx } = fakeContext({ search: failed("MCP HTTP request failed with status 429") });
    await expect(callMcpTool(ctx, "search", {})).rejects.toThrow(/^MCP HTTP request failed with status 429$/);
  });

  it("throws when pi kept no MCP result", async () => {
    const executeTool = async () => ({ toolCall: {}, isError: false, result: { content: [] } });
    const ctx = { executeTool } as unknown as ExtensionToolContext;
    await expect(callMcpTool(ctx, "search", {})).rejects.toThrow("search returned no MCP result.");
  });
});

describe("siteOf", () => {
  it.each([
    ["the hostname", "https://developer.mozilla.org/en-US/docs", "developer.mozilla.org"],
    ["drops www.", "https://www.example.com/page", "example.com"],
    ["keeps a www. that isn't first", "https://docs.www.example.com/", "docs.www.example.com"],
    ["undefined for a URL that doesn't parse", "not a url", undefined],
  ])("%s", (_rule, url, expected) => {
    expect(siteOf(url)).toBe(expected);
  });
});
