import { describe, expect, it } from "vitest";
import { changedPaths, parseWorktrees, validateName } from "#core/worktree/git";

describe("validateName", () => {
  it.each([
    ["a", true],
    ["0-name", true],
    ["a".repeat(64), true],
    ["", false],
    ["a".repeat(65), false],
    ["../escape", false],
    ["-option", false],
    ["Upper", false],
    ["a b", false],
  ])("%j is valid: %s", (name, valid) => {
    if (valid) expect(() => validateName(name)).not.toThrow();
    else expect(() => validateName(name)).toThrow("Worktree name");
  });
});

describe("parseWorktrees", () => {
  it("reads each record's path, HEAD, and branch, keeping spaces in paths, and marks the first as primary", () => {
    const output = "worktree /main dir\0HEAD a1\0branch refs/heads/main\0\0worktree /other\0HEAD b2\0detached\0\0";

    expect(parseWorktrees(output)).toEqual([
      { path: "/main dir", head: "a1", branch: "refs/heads/main", primary: true },
      { path: "/other", head: "b2", branch: undefined, primary: false },
    ]);
  });
});

describe("changedPaths", () => {
  it.each([
    ["a modified file", " M src/a.ts\0", ["src/a.ts"]],
    ["an untracked file", "?? new.md\0", ["new.md"]],
    ["a rename, with its source", "R  to.ts\0from.ts\0", ["to.ts", "from.ts"]],
    ["nothing", "", []],
  ])("lists %s", (_case, output, paths) => {
    expect(changedPaths(output)).toEqual(paths);
  });
});
