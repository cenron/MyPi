import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Worktrees } from "../../../src/core/worktree";
import { fakeSession } from "../../fakes";

const execute = promisify(execFile);
let root: string;
let main: string;
let service: Worktrees;
async function git(cwd: string, ...args: string[]) {
  return (
    await execute("git", args, {
      cwd,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    })
  ).stdout.trim();
}
async function commit(cwd: string) {
  await git(cwd, "add", ".");
  await git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
}
async function put(cwd: string, file: string, text = "local work") {
  const path = join(cwd, file);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mypi-worktree-test-")));
  main = join(root, "main space\t\nline");
  await mkdir(main);
  await git(main, "init", "-b", "main");
  await put(main, "tracked", "base");
  await put(main, ".gitignore", "node_modules/\ncoverage/\n.env\n.pi/memories/\n.pi/plans/\n");
  await commit(main);
  service = new Worktrees(main);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("shared Worktrees service", () => {
  it("validates mutation names before repository discovery", async () => {
    const outside = new Worktrees(root);
    await expect(outside.create("../escape")).rejects.toThrow("Worktree name");
    await expect(outside.remove("../escape")).rejects.toThrow("Worktree name");
  });

  it("lists without writes; creates and removes without changing caller cwd or unrelated branches", async () => {
    const cwd = process.cwd();
    const { session } = fakeSession([], main);
    service = session.worktrees;
    const manager = session.ctx.sessionManager;
    expect(await service.list()).toMatchObject([{ path: main, primary: true, managedName: undefined }]);
    await expect(access(join(main, ".pi"))).rejects.toThrow();
    await git(main, "branch", "unrelated");
    const { worktree, baseCommit } = await service.create("task");
    expect(worktree).toMatchObject({ path: join(main, ".pi/worktrees/task"), managedName: "task", head: baseCommit });
    expect(await readFile(join(main, ".pi/worktrees/.gitignore"), "utf8")).toBe("*\n");
    expect(await service.remove("task")).toMatchObject({ branchDeleted: true });
    expect(await git(main, "branch", "--list", "unrelated")).toContain("unrelated");
    expect(process.cwd()).toBe(cwd);
    expect(service.cwd).toBe(main);
    expect(session.ctx.cwd).toBe(main);
    expect(session.ctx.sessionManager).toBe(manager);
  });

  it("uses a dirty linked caller's committed HEAD and primary storage, including subdirectories", async () => {
    const caller = join(root, "caller");
    await git(main, "worktree", "add", "-b", "caller", caller);
    await put(caller, "tracked", "caller commit");
    await commit(caller);
    const head = await git(caller, "rev-parse", "HEAD");
    await put(caller, "tracked", "uncommitted");
    await mkdir(join(caller, "subdir"));
    const created = await new Worktrees(join(caller, "subdir")).create("from-caller");
    expect(created.baseCommit).toBe(head);
    expect(created.worktree.path).toBe(join(main, ".pi/worktrees/from-caller"));
    expect(await readFile(join(created.worktree.path, "tracked"), "utf8")).toBe("caller commit");
    expect(await service.remove("from-caller")).toMatchObject({
      branchDeleted: false,
      reason: expect.stringContaining("not an ancestor"),
    });
    expect(await git(main, "rev-parse", "mypi/worktree/from-caller")).toBe(head);
    expect((await service.list()).some((entry) => entry.path === caller)).toBe(true);
  });

  it.each(["path", "branch", "registration"])("refuses an existing %s without clobbering", async (kind) => {
    const target = join(main, ".pi/worktrees/task");
    if (kind === "path") await put(target, "keep");
    if (kind === "branch") await git(main, "branch", "mypi/worktree/task");
    if (kind === "registration") await service.create("task");
    await expect(service.create("task")).rejects.toThrow("already exists");
    if (kind === "path") expect(await readFile(join(target, "keep"), "utf8")).toBe("local work");
  });

  it.each(["tracked", "staged", "untracked", "rename", "memory", "plan", "tracked-memory", "tracked-plan"])(
    "protects %s work and lists paths",
    async (kind) => {
      if (kind.startsWith("tracked-")) {
        const file = kind === "tracked-memory" ? ".pi/memories/saved.md" : ".pi/plans/saved.md";
        await put(main, file, "committed");
        await git(main, "add", "-f", file);
        await commit(main);
      }
      const { worktree } = await service.create("task");
      let file = "tracked";
      if (kind === "untracked") file = "new-file";
      if (kind === "memory" || kind === "tracked-memory") file = ".pi/memories/saved.md";
      if (kind === "plan" || kind === "tracked-plan") file = ".pi/plans/saved.md";
      if (kind === "rename") await git(worktree.path, "mv", "tracked", "renamed");
      else await put(worktree.path, file);
      if (kind === "staged") await git(worktree.path, "add", file);
      await expect(service.remove("task")).rejects.toThrow(file);
      expect((await service.list()).find((entry) => entry.managedName === "task")).toBeDefined();
      if (kind !== "rename") expect(await readFile(join(worktree.path, file), "utf8")).toBe("local work");
    },
  );

  it("removes a worktree containing only memory and plan ignore markers", async () => {
    const { worktree } = await service.create("task");
    await put(worktree.path, ".pi/memories/.gitignore", "*\n");
    await put(worktree.path, ".pi/plans/.gitignore", "*\n");
    expect((await service.remove("task")).branchDeleted).toBe(true);
    await expect(access(worktree.path)).rejects.toThrow();
  });

  it("allows ordinary ignored artifacts and unchanged committed memories/plans", async () => {
    for (const file of [".pi/memories/saved.md", ".pi/plans/saved.md"]) {
      await put(main, file);
      await git(main, "add", "-f", file);
    }
    await commit(main);
    const { worktree } = await service.create("task");
    for (const file of ["node_modules/pkg/index.js", "coverage/report", ".env"]) await put(worktree.path, file);
    expect((await service.remove("task")).branchDeleted).toBe(true);
    await expect(access(worktree.path)).rejects.toThrow();
  });

  it("refuses the calling worktree and locked worktrees", async () => {
    const { worktree } = await service.create("task");
    await mkdir(join(worktree.path, "subdir"));
    await expect(new Worktrees(join(worktree.path, "subdir")).remove("task")).rejects.toThrow("calling cwd");
    await git(main, "worktree", "lock", "--reason", "fixture lock", worktree.path);
    await expect(service.remove("task")).rejects.toThrow("locked or prunable");
  });

  it("refuses a prunable registration without pruning it", async () => {
    const { worktree } = await service.create("task");
    await rm(worktree.path, { recursive: true });
    await expect(service.remove("task")).rejects.toThrow("locked or prunable");
    expect((await service.list()).find((entry) => entry.managedName === "task")?.prunable).toBeDefined();
  });

  it.each(["foreign", "renamed", "detached", "primary"])("never adopts a %s checkout", async (kind) => {
    const target = join(main, ".pi/worktrees/task");
    if (kind === "foreign") {
      await mkdir(join(target, ".."), { recursive: true });
      await git(main, "worktree", "add", "-b", "foreign", target);
    } else if (kind === "primary") await git(main, "branch", "-m", "mypi/worktree/task");
    else {
      await service.create("task");
      if (kind === "renamed") await git(target, "branch", "-m", "foreign");
      else await git(target, "checkout", "--detach");
    }
    await expect(service.remove("task")).rejects.toThrow("No MyPi-managed");
    expect((await service.list()).every((entry) => entry.managedName === undefined)).toBe(true);
  });

  it.each([".pi", ".pi/worktrees", ".pi/worktrees/task"])(
    "refuses symlink component %s on create and remove",
    async (component) => {
      const outside = join(root, "outside");
      await mkdir(outside);
      const path = join(main, component);
      await mkdir(join(path, ".."), { recursive: true });
      await symlink(outside, path);
      await expect(service.create("task")).rejects.toThrow("Symlinked");
      await expect(service.remove("task")).rejects.toThrow("Symlinked");
      expect(await readFile(join(main, "tracked"), "utf8")).toBe("base");
    },
  );

  it("reports unsupported directories, unborn HEAD, and bare primary repositories", async () => {
    await expect(new Worktrees(root).list()).rejects.toThrow("Git worktree list");
    const unborn = join(root, "unborn");
    await mkdir(unborn);
    await git(unborn, "init");
    await expect(new Worktrees(unborn).create("task")).rejects.toThrow("HEAD^{commit}");
    const bare = join(root, "bare");
    await git(root, "init", "--bare", bare);
    await expect(new Worktrees(bare).list()).rejects.toThrow("non-bare primary");
  });

  it("passes abort signals without creating a checkout", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(service.create("task", controller.signal)).rejects.toThrow("aborted");
    expect(await service.list()).toHaveLength(1);
  });

  it("reports failed creation and leaves partial Git state for inspection", async () => {
    const hooks = join(root, "hooks");
    await put(hooks, "post-checkout", "#!/bin/sh\nexit 1\n");
    await chmod(join(hooks, "post-checkout"), 0o755);
    await git(main, "config", "core.hooksPath", hooks);
    await expect(service.create("task")).rejects.toThrow("No automatic rollback");
    expect(await git(main, "rev-parse", "mypi/worktree/task")).toBe(await git(main, "rev-parse", "HEAD"));
  });

  it("returns partial cleanup when a merged branch is still checked out elsewhere", async () => {
    await service.create("task");
    const other = join(root, "other");
    await git(main, "worktree", "add", "--detach", other, "HEAD");
    await git(other, "checkout", "--ignore-other-worktrees", "mypi/worktree/task");
    expect(await service.remove("task")).toMatchObject({
      branchDeleted: false,
      reason: expect.stringContaining("Checkout removed, branch kept"),
    });
    expect(await git(other, "branch", "--show-current")).toBe("mypi/worktree/task");
  });

  it("protects dirty submodules and propagates Git's clean-submodule removal refusal", async () => {
    const sub = join(root, "sub");
    await mkdir(sub);
    await git(sub, "init");
    await put(sub, "file");
    await commit(sub);
    await git(main, "-c", "protocol.file.allow=always", "submodule", "add", sub, "sub");
    await commit(main);
    const { worktree } = await service.create("task");
    await git(worktree.path, "-c", "protocol.file.allow=always", "submodule", "update", "--init");
    await put(worktree.path, "sub/file", "changed");
    await expect(service.remove("task")).rejects.toThrow('"sub"');
    await git(join(worktree.path, "sub"), "checkout", "--", "file");
    await expect(service.remove("task")).rejects.toThrow("Git worktree remove");
    expect(await git(main, "rev-parse", "mypi/worktree/task")).toBeTruthy();
    expect(await readFile(join(worktree.path, "sub/file"), "utf8")).toBe("local work");
  });
});
