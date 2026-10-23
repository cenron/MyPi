import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMemories } from "#module/memory/folders";

describe("readMemories", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mypi-memory-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists every .md file by its path without .md, sorted, with its description (or a flag for invalid YAML) and links", async () => {
    await mkdir(join(dir, "build"));
    await writeFile(join(dir, "build", "tests.md"), "---\ndescription: How to run the tests\n---\n");
    await writeFile(join(dir, "workflow.md"), "No frontmatter. See [[build/tests]].\n");
    await writeFile(join(dir, "colon.md"), "---\ndescription: Run: npm test\n---\n");
    await writeFile(join(dir, ".gitignore"), "*\n");
    await writeFile(join(dir, "notes.txt"), "not a memory\n");

    expect(readMemories(dir)).toEqual([
      { name: "build/tests", description: "How to run the tests", links: [] },
      { name: "colon", description: "(frontmatter isn't valid YAML; fix it)", links: [] },
      { name: "workflow", description: undefined, links: ["build/tests"] },
    ]);
  });

  it("is empty when the folder doesn't exist", () => {
    expect(readMemories(join(dir, "missing"))).toEqual([]);
  });
});
