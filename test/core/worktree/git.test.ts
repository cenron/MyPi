import { describe, expect, it } from "vitest";
import {
  BRANCH_PREFIX,
  changedPaths,
  managedName,
  parseWorktrees,
  validateName,
  type Worktree,
} from "#core/worktree/git";

describe("worktree Git rules", () => {
  it.each([
    ["a", true],
    ["0-name", true],
    ["a".repeat(64), true],
    ["", false],
    ["a".repeat(65), false],
    ["../escape", false],
    ["a/b", false],
    ["a\\b", false],
    ["-option", false],
    ["Upper", false],
    ["a b", false],
    ["a\n", false],
  ])("validates %j", (name, valid) => {
    if (valid) expect(() => validateName(name)).not.toThrow();
    else expect(() => validateName(name)).toThrow("Worktree name");
  });

  it("parses NUL paths and all Git flags without losing reasons", () => {
    const entries = parseWorktrees(
      "worktree /main space\t\nline\0HEAD abc\0branch refs/heads/main\0\0worktree /linked\0HEAD def\0detached\0locked manual\nreason\0prunable missing\0\0worktree /bare\0bare\0\0",
    );
    expect(entries).toEqual([
      {
        path: "/main space\t\nline",
        head: "abc",
        branch: "refs/heads/main",
        primary: true,
        bare: false,
        detached: false,
      },
      {
        path: "/linked",
        head: "def",
        primary: false,
        bare: false,
        detached: true,
        locked: "manual\nreason",
        prunable: "missing",
      },
      { path: "/bare", primary: false, bare: true, detached: false },
    ]);
    expect(parseWorktrees("worktree /main\0locked\0\0")[0]?.locked).toBe("");
    expect(() => parseWorktrees("HEAD abc\0\0")).toThrow("missing path");
  });

  const entry: Worktree = {
    path: "/main/.pi/worktrees/task",
    branch: `${BRANCH_PREFIX}task`,
    primary: false,
    detached: false,
    bare: false,
  };
  it.each([
    [{}, "task"],
    [{ primary: true }, undefined],
    [{ detached: true }, undefined],
    [{ bare: true }, undefined],
    [{ branch: "refs/heads/foreign" }, undefined],
    [{ branch: undefined }, undefined],
    [{ branch: `${BRANCH_PREFIX}../escape` }, undefined],
    [{ path: "/elsewhere/task" }, undefined],
    [{ path: "/main/.pi/worktrees/nested/task" }, undefined],
  ])("classifies ownership %j", (changes, expected) => {
    expect(managedName({ ...entry, ...changes }, "/main")).toBe(expected);
  });

  it("reports rename sources and destinations, untracked and staged paths", () => {
    expect(changedPaths("R  new\nname\0old\tname\0?? untracked\0 M tracked\0")).toEqual([
      "new\nname",
      "old\tname",
      "untracked",
      "tracked",
    ]);
  });
});
