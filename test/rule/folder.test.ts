import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolEnv } from "#core/tool-guard";
import { FolderRule } from "#rule/folder";

const env: ToolEnv = {
  cwd: "/home/me/work/app",
  home: "/home/me",
  writableDirs: ["/home/me/.pi/agent/memories"],
  writableTools: new Set(),
};

/** The rule, with the skill folder and context file pi's prompt listed. */
const rule = new FolderRule({ paths: ["/home/me/.agents/skills/herdr", "/home/me/work/AGENTS.md"] });

const verdict = (toolName: string, input: Record<string, unknown>) => rule.check({ toolName, input }, env);
const asks = (...paths: string[]) => ({
  kind: "ask",
  questions: paths.map((path) => `Reaches outside /home/me/work/app: ${path} (and anything under it)`),
  onAllowSession: expect.any(Function),
});

describe("FolderRule", () => {
  it.each([
    ["a path inside the folder", "read", { path: "src/a.ts" }],
    ["the folder itself", "ls", { path: "." }],
    ["an absolute path inside", "read", { path: "/home/me/work/app/README.md" }],
    ["a call without a path (the folder by default)", "grep", { pattern: "x" }],
    ["a path that isn't a string", "read", { path: 3 }],
    ["a module's own folder", "write", { path: "~/.pi/agent/memories/a.md" }],
    ["a skill folder from the prompt", "read", { path: "/home/me/.agents/skills/herdr/SKILL.md" }],
    ["a context file from the prompt", "read", { path: "../AGENTS.md" }],
    ["the temp folder", "read", { path: join(tmpdir(), "pi-bash-1.log") }],
    ["a /dev stream", "write", { path: "/dev/null" }],
    ["an MCP tool's path, which isn't a file", "mcp__docs__get", { path: "/v1/users" }],
    ["a bash command whose paths are all allowed", "bash", { command: "cat src/a.ts > /dev/null; ls ../AGENTS.md" }],
  ])("allows %s", (_case, tool, input) => {
    expect(verdict(tool, input)).toEqual({ kind: "allow" });
  });

  it.each([
    ["the parent folder", "find", { path: ".." }, "/home/me/work"],
    ["a sibling project", "read", { path: "../other/a.ts" }, "/home/me/work/other/a.ts"],
    ["the home folder", "find", { path: "~" }, "/home/me"],
    ["an absolute path elsewhere", "grep", { path: "/home/me/Documents" }, "/home/me/Documents"],
    ["a folder that only starts like the session's", "ls", { path: "/home/me/work/app-old" }, "/home/me/work/app-old"],
    [
      "a skill pi didn't list",
      "read",
      { path: "/home/me/.agents/skills/other/SKILL.md" },
      "/home/me/.agents/skills/other/SKILL.md",
    ],
    ["any tool with a path, lsp included", "lsp", { action: "outline", path: "/etc/hosts" }, "/etc/hosts"],
  ])("asks for %s, naming the resolved path", (_case, tool, input, path) => {
    expect(verdict(tool, input)).toEqual(asks(path));
  });

  it.each([
    ["the same path", "/elsewhere/tree", "/elsewhere/tree", true],
    ["a descendant two levels down", "/elsewhere/tree", "/elsewhere/tree/sub/file.md", true],
    ["the parent", "/elsewhere/tree", "/elsewhere", false],
    ["a sibling", "/elsewhere/tree", "/elsewhere/other", false],
    ["a prefix lookalike", "/elsewhere/tree", "/elsewhere/tree-old", false],
    ["a file's sibling", "/elsewhere/file.md", "/elsewhere/other.md", false],
    ["a file's parent", "/elsewhere/file.md", "/elsewhere", false],
  ])("session approval covers only the named tree: %s", (_case, path, laterPath, allowed) => {
    const fresh = new FolderRule({ paths: [] });
    const call = { toolName: "read", input: { path } };
    const approval = fresh.check(call, env);
    expect(fresh.check(call, env).kind).toBe("ask"); // Checking alone must not grant access.
    if (approval.kind !== "ask") throw new Error("Expected an approval request");
    approval.onAllowSession?.();

    expect(fresh.check({ toolName: "read", input: { path: laterPath } }, env).kind).toBe(allowed ? "allow" : "ask");
  });

  it("remembers every approved path and asks only about paths outside those trees", () => {
    const fresh = new FolderRule({ paths: [] });
    const approval = fresh.check({ toolName: "bash", input: { command: "ls /elsewhere/tree /another/tree" } }, env);
    if (approval.kind !== "ask") throw new Error("Expected an approval request");
    approval.onAllowSession?.();

    const command = "cat /elsewhere/tree/a /elsewhere/tree/sub/b /another/tree/c";
    expect(fresh.check({ toolName: "bash", input: { command } }, env)).toEqual({ kind: "allow" });
    expect(fresh.check({ toolName: "bash", input: { command: `${command} /unapproved/file` } }, env)).toEqual(
      asks("/unapproved/file"),
    );
  });

  // commandPaths' own table covers which words are paths; here, only that bash goes through it.
  it("asks once per outside path a bash command names, each its own question", () => {
    const command = "cat /etc/hosts src/a.ts && diff ~/a /etc/hosts";
    expect(verdict("bash", { command })).toEqual(asks("/etc/hosts", "/home/me/a"));
  });
});
