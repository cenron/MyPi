import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keepOutOfGit } from "#core/util/git";

describe("keepOutOfGit", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mypi-git-"));
  });
  afterEach(async () => {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a .gitignore of *", async () => {
    await keepOutOfGit(dir);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("*\n");
  });

  // Editing the file is how a project opts back in, so a second call must keep the edit.
  it("never overwrites an existing .gitignore", async () => {
    await writeFile(join(dir, ".gitignore"), "edited\n");
    await keepOutOfGit(dir);
    expect(await readFile(join(dir, ".gitignore"), "utf8")).toBe("edited\n");
  });

  // A read-only folder fails with EACCES, which must not be swallowed like EEXIST.
  it("passes on any error but EEXIST", async () => {
    await chmod(dir, 0o500);
    await expect(keepOutOfGit(dir)).rejects.toMatchObject({ code: "EACCES" });
  });
});
