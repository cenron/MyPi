import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "#module/subagents/agents";
import { captureWork, PATCHES_DIR, prepareWriter } from "#module/subagents/writer";
import { fakeSession } from "../../fakes";

const execute = promisify(execFile);
const developer: AgentDefinition = {
  name: "developer",
  description: "Implement",
  access: "write",
  model: "inherit",
  thinking: "inherit",
  prompt: "Implement",
};

let root: string;
let main: string;
let session: ReturnType<typeof fakeSession>["session"];

async function git(cwd: string, ...args: string[]) {
  return (await execute("git", args, { cwd })).stdout.trim();
}

async function commit(cwd: string) {
  await git(cwd, "add", "-A");
  await git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");
}

async function put(cwd: string, file: string, text = "work") {
  const path = join(cwd, file);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, text);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mypi-writer-")));
  main = join(root, "main");
  await mkdir(main);
  await git(main, "init", "-b", "main");
  await put(main, "tracked", "base");
  await commit(main);
  session = fakeSession([], main, { main, commonDir: join(main, ".git") }).session;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("writer work", () => {
  it("doesn't reuse the name of a patch still waiting to be applied", async () => {
    await mkdir(join(main, PATCHES_DIR), { recursive: true });
    // As `captureWork` leaves it: kept out of git by its own `.gitignore`.
    await writeFile(join(main, PATCHES_DIR, ".gitignore"), "*\n");
    await writeFile(join(main, PATCHES_DIR, "sub-developer-1.patch"), "");

    expect((await prepareWriter(session, developer)).name).toBe("sub-developer-2");
  });

  it("refuses a dirty caller checkout and lists the changed file", async () => {
    await put(main, "local.txt");

    await expect(prepareWriter(session, developer)).rejects.toThrow("local.txt");
    expect(await session.worktrees.list()).toHaveLength(1);
  });

  it("captures a patch that applies cleanly to the base and discards its worktree", async () => {
    const prepared = await prepareWriter(session, developer);
    await put(prepared.path, "new.txt", "writer change\n");

    const captured = await captureWork(session, prepared, developer, "Add a file", "Added it.");

    expect(captured.files).toEqual(["new.txt"]);
    expect(captured.patchPath).toBe(join(main, ".pi", "patches", `${prepared.name}.patch`));
    expect(captured.diffStat).toContain("new.txt");
    expect(await git(main, "apply", "--check", captured.patchPath as string)).toBe("");
    expect(await readFile(captured.handoffPath as string, "utf8")).toContain("Added it.");
    expect((await session.worktrees.list()).some((worktree) => worktree.managedName === prepared.name)).toBe(false);
  });

  it("says when the writer changed nothing and creates no handoff", async () => {
    const prepared = await prepareWriter(session, developer);

    expect(await captureWork(session, prepared, developer, "Look", "Nothing changed.")).toEqual({
      name: prepared.name,
      files: [],
    });
    await expect(readFile(join(main, ".pi", "patches", `${prepared.name}.patch`))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("includes changes committed by the child", async () => {
    const prepared = await prepareWriter(session, developer);
    await put(prepared.path, "committed.txt", "child commit\n");
    await commit(prepared.path);

    const captured = await captureWork(session, prepared, developer, "Commit work", "Committed it.");
    const patch = await readFile(captured.patchPath as string, "utf8");

    expect(captured.files).toEqual(["committed.txt"]);
    expect(patch).toContain("child commit");
    expect(captured.diffStat).toContain("committed.txt");
  });
});
