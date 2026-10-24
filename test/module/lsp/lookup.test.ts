import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCommand, markedFolders } from "#module/lsp/util/lookup";

let dir: string;

// dir/repo/package.json, dir/repo/pkg/tsconfig.json, dir/loose/; bin1 and bin2 hold commands.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-"));
  await mkdir(join(dir, "repo/pkg/src"), { recursive: true });
  await mkdir(join(dir, "loose"));
  await writeFile(join(dir, "repo/package.json"), "{}");
  await writeFile(join(dir, "repo/pkg/tsconfig.json"), "{}");

  await mkdir(join(dir, "bin1"));
  await mkdir(join(dir, "bin2"));
  await writeFile(join(dir, "bin1/plain"), "");
  for (const file of ["bin1/tool", "bin2/tool", "bin2/other"]) {
    await writeFile(join(dir, file), "");
    await chmod(join(dir, file), 0o755);
  }
  await mkdir(join(dir, "bin1/folder"));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe("markedFolders", () => {
  it.each([
    ["every marked folder above, nearest first", "repo/pkg/src/a.ts", ["repo/pkg", "repo"]],
    ["a marker in the file's own folder", "repo/pkg/a.ts", ["repo/pkg", "repo"]],
    ["any of the markers", "repo/a.ts", ["repo"]],
    ["none when no folder has one", "loose/a.ts", []],
  ])("finds %s", (_rule, file, folders) => {
    const found = markedFolders(dirname(join(dir, file)), ["tsconfig.json", "package.json"]);
    // The temp folder's parents can hold markers of their own; only the ones inside it are under test.
    expect(found.filter((folder) => folder.startsWith(dir))).toEqual(folders.map((folder) => join(dir, folder)));
  });
});

describe("findCommand", () => {
  const path = () => [join(dir, "bin1"), join(dir, "bin2")].join(delimiter);

  it.each([
    ["the first executable on the path", "tool", "bin1/tool"],
    ["skipping a file that isn't executable", "plain", undefined],
    ["skipping a folder", "folder", undefined],
    ["nothing for a missing command", "nope", undefined],
    ["a later folder when earlier ones lack it", "other", "bin2/other"],
  ])("finds %s", (_rule, command, found) => {
    expect(findCommand(command, path())).toBe(found && join(dir, found));
  });

  it("takes an absolute path as is, when it's executable", () => {
    expect(findCommand(join(dir, "bin2/tool"), "")).toBe(join(dir, "bin2/tool"));
    expect(findCommand(join(dir, "bin1/plain"), path())).toBeUndefined();
  });
});
