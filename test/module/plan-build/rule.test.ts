import type { ToolAnnotations } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { planRule } from "#module/plan-build/rule";

const env = {
  cwd: "/project",
  home: "/home/me",
  writableDirs: ["/project/.pi/plans", "/home/me/.pi/agent/memories"],
  writableTools: new Set(["submit_plan"]),
};
const verdict = (toolName: string, input: Record<string, unknown> = {}, annotations?: ToolAnnotations) =>
  planRule({ toolName, input, annotations }, env);

describe("planRule", () => {
  it.each(["read", "grep", "find", "ls", "tool_search", "codemode", "ask_user", "submit_plan"])("allows %s", (tool) => {
    expect(verdict(tool)).toEqual({ kind: "allow" });
  });

  // Path resolution is paths.test.ts's; here only that the rule uses it with every writable folder.
  it.each([".pi/plans/feature.md", "/project/.pi/plans/feature.md", "~/.pi/agent/memories/build.md"])(
    "allows edit and write to %j",
    (path) => {
      expect(verdict("edit", { path })).toEqual({ kind: "allow" });
      expect(verdict("write", { path })).toEqual({ kind: "allow" });
    },
  );

  it.each(["src/a.ts", "~/.pi/plans/x.md"])("blocks edit and write to %j", (path) => {
    for (const tool of ["edit", "write"]) {
      const result = verdict(tool, { path });
      expect(result.kind).toBe("block");
      expect(result).toMatchObject({ reason: expect.stringContaining("Plan mode is on") });
      expect(result).toMatchObject({ reason: expect.stringContaining(path) });
      expect(result).toMatchObject({ reason: expect.stringContaining("/home/me/.pi/agent/memories") });
    }
  });

  it("blocks edit and write without a string path", () => {
    expect(verdict("write", {}).kind).toBe("block");
    expect(verdict("edit", { path: 42 }).kind).toBe("block");
  });

  it("allows a read-only bash command", () => {
    expect(verdict("bash", { command: "git status && ls" })).toEqual({ kind: "allow" });
  });

  it("asks before any other bash command, showing it", () => {
    expect(verdict("bash", { command: "npm test" })).toEqual({
      kind: "ask",
      question: "Plan mode is on. Run this command?\nnpm test",
    });
    expect(verdict("bash", {}).kind).toBe("ask");
  });

  it("always asks before powershell", () => {
    expect(verdict("powershell", { command: "Get-ChildItem" })).toEqual({
      kind: "ask",
      question: "Plan mode is on. Run this PowerShell command?\nGet-ChildItem",
    });
  });

  it("allows another tool only when it's marked read-only", () => {
    expect(verdict("mcp_search", {}, { readOnlyHint: true })).toEqual({ kind: "allow" });
    for (const annotations of [undefined, {}, { readOnlyHint: false }, { destructiveHint: false }]) {
      expect(verdict("mcp_search", {}, annotations)).toEqual({
        kind: "ask",
        question: "Plan mode is on. Allow mcp_search? It isn't marked read-only.",
      });
    }
  });

  it("asks before a tool named like an Object.prototype key", () => {
    expect(verdict("toString").kind).toBe("ask");
  });
});
