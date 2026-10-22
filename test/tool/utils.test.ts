import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { callMcpTool, textOf } from "#tool/utils";
import { answered, failed, fakeContext } from "./web-search/fakes";

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

describe("textOf", () => {
  it.each([
    [
      "joins text parts with a newline",
      [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
      "one\ntwo",
    ],
    [
      "skips parts that aren't text",
      [
        { type: "image", data: "…" },
        { type: "text", text: "one" },
      ],
      "one",
    ],
    ["is empty for anything but a list", undefined, ""],
  ])("%s", (_rule, content, expected) => {
    expect(textOf(content)).toBe(expected);
  });
});
