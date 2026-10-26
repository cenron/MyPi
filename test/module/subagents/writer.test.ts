import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "#module/subagents/agents";
import { subagentTool } from "#module/subagents/tools/subagent";
import { captureWork, PATCHES_DIR, prepareWriter, runWriter } from "#module/subagents/writer";
import { fakeSession } from "../../fakes";

const execute = promisify(execFile);
const developer: AgentDefinition = {
  name: "developer",
  description: "Implement",
  access: "write",
  model: "inherit",
  thinking: "inherit",
  prompt: "Implement",
  source: "builtin",
  path: "/builtins/developer.md",
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

  it("captures a writer's partial work when its run is stopped", async () => {
    const fake = fakeSession([], main, { main, commonDir: join(main, ".git") });
    const run = async (
      _parent: unknown,
      _agent: AgentDefinition,
      task: string,
      _settings: unknown,
      signal: AbortSignal,
      _step: (step: string) => void,
      cwd?: string,
    ) => {
      expect(task).toContain("don't write patch files");
      expect(cwd).toContain("sub-developer-");
      await put(cwd as string, "partial.txt", "partial work\\n");
      expect(signal.aborted).toBe(true);
      return {
        answer: "Stopped",
        usage: { tokens: 1, cost: 0 },
        sessionFile: undefined,
        changedFiles: [],
        timedOut: false,
      };
    };
    const controller = new AbortController();
    controller.abort();

    const result = await runWriter(
      fake.session,
      fake.session.ctx,
      developer,
      "Add a file",
      {},
      controller.signal,
      () => {},
      run as never,
    );

    expect(result.stopped).toBe(true);
    expect(result.patchName).toBeDefined();
    expect(result.changedFiles).toEqual(["partial.txt"]);
    expect(await git(main, "worktree", "list", "--porcelain")).not.toContain("sub-developer-");
  });

  it("reports the saved patch when the user stops its background job", async () => {
    const fake = fakeSession([], main, { main, commonDir: join(main, ".git") });
    const tool = subagentTool(
      fake.session,
      () => [developer],
      async (_parent, _agent, _task, _settings, signal, _step, cwd) => {
        await put(cwd as string, "partial.txt", "partial work\\n");
        began();
        return await new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                answer: "Stopped",
                usage: { tokens: 1, cost: 0 },
                sessionFile: undefined,
                changedFiles: [],
                timedOut: false,
              }),
            { once: true },
          );
        });
      },
    );
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    await tool.execute(
      "call",
      { agent: "developer", task: "Hold" } as never,
      undefined,
      undefined,
      fake.session.ctx as never,
    );
    await started;
    const stopped = await fake.session.jobs.stop("1");

    expect(stopped?.status).toBe("stopped");
    expect(fake.sendMessage.mock.calls.at(-1)?.[0].content).toContain("Patch: sub-developer-1");
    expect(fake.sendMessage.mock.calls.at(-1)?.[0].content).toContain("partial.txt");
  });

  it("keeps partial work and names its patch when the child fails", async () => {
    const run = async (
      _parent: unknown,
      _agent: AgentDefinition,
      _task: string,
      _settings: unknown,
      _signal: AbortSignal,
      _step: (step: string) => void,
      cwd?: string,
    ) => {
      await put(cwd as string, "partial.txt", "partial work\\n");
      throw new Error("Child failed");
    };
    const fake = fakeSession([], main, { main, commonDir: join(main, ".git") });

    const result = await runWriter(
      fake.session,
      fake.session.ctx,
      developer,
      "Partial change",
      {},
      new AbortController().signal,
      () => {},
      run as never,
    );

    expect(result.failure).toBe("Child failed");
    expect(result.patchName).toBe("sub-developer-1");
    expect(result.changedFiles).toEqual(["partial.txt"]);
    expect(await readdir(join(main, PATCHES_DIR))).toContain("sub-developer-1.patch");
  });

  it("runs in place outside a git project", async () => {
    const fake = fakeSession();
    const run = async (
      _parent: unknown,
      _agent: AgentDefinition,
      _task: string,
      _settings: unknown,
      _signal: AbortSignal,
      _step: (step: string) => void,
      cwd?: string,
    ) => {
      expect(cwd).toBeUndefined();
      return {
        answer: "Done",
        usage: { tokens: 1, cost: 0 },
        sessionFile: undefined,
        changedFiles: [],
        timedOut: false,
      };
    };

    const result = await runWriter(
      fake.session,
      fake.session.ctx,
      developer,
      "Change",
      {},
      new AbortController().signal,
      () => {},
      run as never,
    );

    expect(result.inPlace).toBe(true);
  });

  it("runs three writers concurrently in separate worktrees", async () => {
    const fake = fakeSession([], main, { main, commonDir: join(main, ".git") });
    const tool = subagentTool(
      fake.session,
      () => [developer],
      async (_parent, _agent, _task, _settings, _signal, _step, cwd) => {
        await put(cwd as string, `writer-${cwd?.split("-").at(-1)}.txt`);
        return {
          answer: "Done",
          usage: { tokens: 1, cost: 0 },
          sessionFile: undefined,
          changedFiles: [],
          timedOut: false,
        };
      },
    );
    const call = (task: string) =>
      tool.execute("call", { agent: "developer", task } as never, undefined, undefined, fake.session.ctx as never);

    await call("One");
    await call("Two");
    await call("Three");
    await expect(call("Four")).rejects.toThrow("At most 3");
    await Promise.all(fake.session.jobs.list().map((job) => fake.session.jobs.get(job.id)?.done));

    expect(
      (await fake.session.worktrees.list()).filter((worktree) => worktree.managedName?.startsWith("sub-developer-"))
        .length,
    ).toBe(0);
    expect(await readdir(join(main, PATCHES_DIR))).toContain("sub-developer-1.patch");
    expect(await readdir(join(main, PATCHES_DIR))).toContain("sub-developer-2.patch");
    expect(await readdir(join(main, PATCHES_DIR))).toContain("sub-developer-3.patch");
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
