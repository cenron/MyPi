import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { isInside, resolveToolPath } from "#core/util/paths";
// pi doesn't export resolveToCwd, so the parity test reaches into its dist. A pi upgrade that changes it fails here.
import { resolveToCwd } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js";

const cwd = "/project";
const home = "/home/me";

describe("resolveToolPath", () => {
  it.each([
    ["notes.md", "/project/notes.md"],
    ["./a/../b.md", "/project/b.md"],
    ["../outside.md", "/outside.md"],
    ["/abs/../x.md", "/x.md"],
    ["@src/a.ts", "/project/src/a.ts"],
    ["~", "/home/me"],
    ["~/x.md", "/home/me/x.md"],
    ["@~/x.md", "/home/me/x.md"],
    ["~user/x.md", "/project/~user/x.md"],
    ["file:///tmp/x.md", "/tmp/x.md"],
    ["a b c.md", "/project/a b c.md"],
  ])("resolves %j to %s", (input, expected) => {
    expect(resolveToolPath(input, cwd, home)).toBe(expected);
  });

  it("strips only one @", () => {
    expect(resolveToolPath("@@x", cwd, home)).toBe("/project/@x");
  });

  it.each([
    "notes.md",
    "./a/../b.md",
    "../up",
    "/abs/x",
    "@src/a.ts",
    "~",
    "~/x",
    "@~/x",
    "~user/x",
    "file:///tmp/x",
    "a b",
  ])("matches pi's resolveToCwd for %j", (input) => {
    expect(resolveToolPath(input, cwd, homedir())).toBe(resolveToCwd(input, cwd));
  });
});

describe("isInside", () => {
  const plans = "/project/.pi/plans";

  it.each([
    [plans, true],
    [`${plans}/a.md`, true],
    [`${plans}/deep/a.md`, true],
    [`${plans}/..notes.md`, true],
    [`${plans}-evil/a.md`, false],
    ["/project/.pi", false],
    ["/project/a.md", false],
    [`${plans}/../a.md`, false],
    ["/elsewhere/a.md", false],
  ])("%s is inside: %s", (path, expected) => {
    expect(isInside(plans, path)).toBe(expected);
  });
});
