import { describe, expect, it } from "vitest";
import { createSearchBackendsRule } from "#tool/web-search/rule";
import { EXA_SEARCH_TOOL, exaBackend } from "#tool/web-search/tools/exa";
import { PARALLEL_SEARCH_TOOL, parallelBackend } from "#tool/web-search/tools/parallel";
import { TAVILY_SEARCH_TOOL, tavilyBackend } from "#tool/web-search/tools/tavily";
import { TINYFISH_SEARCH_TOOL, tinyfishBackend } from "#tool/web-search/tools/tinyfish";

const rule = createSearchBackendsRule([parallelBackend("session"), exaBackend(), tinyfishBackend(), tavilyBackend()]);
const reason =
  "Use web_search: it tries the next search service when one fails and rests ones that hit their limit. " +
  "Don't call the services' own tools.";
const backendTools = [PARALLEL_SEARCH_TOOL, EXA_SEARCH_TOOL, TINYFISH_SEARCH_TOOL, TAVILY_SEARCH_TOOL];

const call = (toolName: string, parentToolName?: string) => ({ toolName, input: {}, parentToolName });
const env = { cwd: "/project", home: "/home/me", writableDirs: [], writableTools: new Set<string>(), readableDirs: [] };

describe("web_search backend rule", () => {
  it.each(backendTools)("allows %s when called by web_search", (toolName) => {
    expect(rule(call(toolName, "web_search"), env)).toEqual({ kind: "allow" });
  });

  it.each([
    ["the model", undefined],
    ["codemode", "codemode"],
  ])("blocks a direct backend call from %s", (_source, parentToolName) => {
    expect(rule(call(EXA_SEARCH_TOOL, parentToolName), env)).toEqual({ kind: "block", reason });
  });

  it("allows other MCP tools", () => {
    expect(rule(call("mcp__files__read"), env)).toEqual({ kind: "allow" });
  });
});
