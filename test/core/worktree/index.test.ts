import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Worktrees } from "#core/worktree/index";

const execute = promisify(execFile);

let root: string;
let main: string;
let service: Worktrees;

async function git(cwd: string, ...args: string[]) {
  return (await execute("git", args, { cwd })).stdout.trim();
}

async function commit(cwd: string) {
  await git(cwd, "add", ".");
  await git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
}

async function put(cwd: string, file: string, text = "work") {
  await mkdir(join(cwd, file, ".."), { recursive: true });
  await writeFile(join(cwd, file), text);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mypi-worktree-")));
  main = join(root, "main repo");
  await mkdir(main);
  await git(main, "init", "-b", "main");
  await put(main, "tracked", "base");
  await put(main, ".gitignore", "node_modules/\n.pi/memories/\n.pi/plans/\n");
  await commit(main);
  service = new Worktrees(main);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("Worktrees", () => {
  it("finds the main checkout and git's shared folder from inside a linked checkout", async () => {
    const linked = join(root, "linked");
    await git(main, "worktree", "add", "-b", "linked", linked);

    expect(await new Worktrees(linked).project()).toEqual({ main, commonDir: join(main, ".git") });
  });

  it("has no project outside git", async () => {
    expect(await new Worktrees(root).project()).toBeUndefined();
  });

  it("creates .pi/worktrees/<name> on its own branch from the caller's HEAD, kept out of git", async () => {
    const worktree = await service.create("task");

    expect(worktree).toMatchObject({
      path: join(main, ".pi/worktrees/task"),
      branch: "refs/heads/mypi/worktree/task",
      head: await git(main, "rev-parse", "HEAD"),
      managedName: "task",
    });
    expect(await readFile(join(main, ".pi/worktrees/.gitignore"), "utf8")).toBe("*\n");
  });

  it("treats a checkout at a managed path on another branch as not MyPi's", async () => {
    await git(main, "worktree", "add", "-b", "other", join(main, ".pi/worktrees/task"));

    expect((await service.list()).find((entry) => !entry.primary)?.managedName).toBeUndefined();
    await expect(service.remove("task")).rejects.toThrow("No MyPi worktree named task");
  });

  it("removes a clean worktree and its merged branch", async () => {
    const { path } = await service.create("task");

    expect(await service.remove("task")).toEqual({ path, branch: "mypi/worktree/task", branchDeleted: true });
    expect(await git(main, "branch", "--list", "mypi/worktree/task")).toBe("");
  });

  it("discards work in a managed worktree and deletes its branch", async () => {
    const { path } = await service.create("task");
    await put(path, "tracked", "changed");
    await put(path, "new.txt");

    await service.discard("task");

    expect(await git(main, "worktree", "list", "--porcelain")).not.toContain(path);
    expect(await git(main, "branch", "--list", "mypi/worktree/task")).toBe("");
  });

  it.each([".pi/memories/local.md", ".pi/plans/local.md"])("refuses to discard local state at %s", async (file) => {
    const { path } = await service.create("task");
    await put(path, file);

    await expect(service.discard("task")).rejects.toThrow(file);
    expect(await git(main, "branch", "--list", "mypi/worktree/task")).not.toBe("");
  });

  it("only discards managed worktrees and never the checkout it is called from", async () => {
    await expect(service.discard("missing")).rejects.toThrow("No MyPi worktree named missing");
    const { path } = await service.create("task");

    await expect(new Worktrees(path).discard("task")).rejects.toThrow("Leave worktree task");
  });

  it("removes the checkout but keeps a branch with unmerged commits, saying why", async () => {
    const { path } = await service.create("task");
    await put(path, "tracked", "committed in the worktree");
    await commit(path);

    expect(await service.remove("task")).toMatchObject({
      branchDeleted: false,
      reason: expect.stringContaining("not fully merged"),
    });
  });

  it.each([
    ["a changed tracked file", "tracked"],
    ["an untracked file", "new.txt"],
    ["a new memory, though ignored", ".pi/memories/a.md"],
    ["a new plan, though ignored", ".pi/plans/a.md"],
  ])("refuses to remove a worktree with %s, listing it", async (_case, file) => {
    const { path } = await service.create("task");
    await put(path, file);

    await expect(service.remove("task")).rejects.toThrow(file);
  });

  it("removes a worktree whose only extras are other ignored files and the ignore markers", async () => {
    const { path } = await service.create("task");
    await put(path, "node_modules/x/index.js");
    await put(path, ".pi/memories/.gitignore", "*\n");
    await put(path, ".pi/plans/.gitignore", "*\n");

    await expect(service.remove("task")).resolves.toMatchObject({ branchDeleted: true });
  });

  it("refuses to remove the worktree it's called from", async () => {
    const { path } = await service.create("task");

    await expect(new Worktrees(path).remove("task")).rejects.toThrow("Leave worktree task");
  });
});
