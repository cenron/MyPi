import { describe, expect, it } from "vitest";
import { SUMMARY_MAX, summarize } from "#module/quiet/summary";

describe("summarize", () => {
  it.each([
    ["read", { path: "/project/src/a.ts" }, "src/a.ts"],
    ["edit", { path: "src/a.ts" }, "src/a.ts"],
    ["write", { path: "/outside/a.ts" }, "/outside/a.ts"],
    ["lsp_edit", { path: "src/a.ts" }, "src/a.ts"],
    ["bash", { command: "npm test\nthen deploy" }, "npm test"],
    ["grep", { pattern: "Quiet", path: "src" }, "Quiet in src"],
    ["find", { pattern: "*.ts", path: "src" }, "*.ts in src"],
    ["web_search", { query: "pi renderer API" }, "pi renderer API"],
    ["web_fetch", { url: "https://example.com/docs/page?q=1#top" }, "example.com/docs/page"],
    [
      "subagent",
      { agent: "explore", task: "Find the renderer implementation across files" },
      "explore · Find the renderer implementation across files",
    ],
    ["task_create", { subject: "Run the complete test suite" }, "Run the complete test suite"],
    ["task_update", { taskId: "12", status: "in_progress" }, "12 · in_progress"],
    ["mcp__exa__search", { query: "find a package" }, "mcp__exa__search find a package"],
  ])("summarizes %s", (toolName, args, expected) => {
    expect(summarize(toolName, args, "/project")).toBe(expected);
  });

  it.each([
    ["bash", { command: "x".repeat(SUMMARY_MAX + 10) }],
    ["grep", { pattern: "x".repeat(SUMMARY_MAX + 10), path: "src" }],
    ["read", { path: `/elsewhere/${"x".repeat(SUMMARY_MAX + 10)}.ts` }],
    ["web_fetch", { url: `https://example.com/${"x".repeat(SUMMARY_MAX + 10)}` }],
  ])("cuts a long %s summary to SUMMARY_MAX characters", (toolName, args) => {
    const summary = summarize(toolName, args, "/project");
    expect(summary).toHaveLength(SUMMARY_MAX);
    expect(summary.endsWith("…")).toBe(true);
  });
});
