import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileChangeType } from "vscode-languageserver-protocol/node";
import { fileChanges, findSourceFile, sourceFileTimes } from "#module/lsp/util/walk";

let tree: string;

// Nearest first: the hidden and node_modules files sit one folder down, c.ts two, far.ts (last by name) three.
beforeAll(async () => {
  tree = await mkdtemp(join(tmpdir(), "mypi-lsp-walk-"));
  for (const folder of ["z/y/x", ".hidden", "node_modules", "src/lib"]) {
    await mkdir(join(tree, folder), { recursive: true });
  }
  for (const file of ["README.md", "z/y/x/far.ts", ".hidden/a.ts", "node_modules/b.ts", "src/lib/c.ts"]) {
    await writeFile(join(tree, file), "");
  }
});
afterAll(() => rm(tree, { recursive: true, force: true }));

describe("findSourceFile", () => {
  it("finds the file in the nearest folder, skipping hidden folders and node_modules", async () => {
    expect(await findSourceFile(tree, [".ts"])).toBe(join(tree, "src/lib/c.ts"));
  });

  it("finds nothing when no file has the extensions", async () => {
    expect(await findSourceFile(tree, [".go"])).toBeUndefined();
  });
});

describe("sourceFileTimes", () => {
  it("times every file with the extensions, skipping hidden folders and node_modules", async () => {
    const times = await sourceFileTimes(tree, [".ts"]);
    expect([...times.keys()].sort()).toEqual([join(tree, "src/lib/c.ts"), join(tree, "z/y/x/far.ts")]);
    expect(times.get(join(tree, "src/lib/c.ts"))).toBeGreaterThan(0);
  });
});

describe("fileChanges", () => {
  const before = new Map([
    ["kept", 1],
    ["edited", 1],
    ["gone", 1],
  ]);
  const after = new Map([
    ["kept", 1],
    ["edited", 2],
    ["new", 1],
  ]);

  it("reports files that appeared, changed, or went away, and nothing for the rest", () => {
    expect(fileChanges(before, after)).toEqual([
      { file: "edited", type: FileChangeType.Changed },
      { file: "new", type: FileChangeType.Created },
      { file: "gone", type: FileChangeType.Deleted },
    ]);
  });
});
