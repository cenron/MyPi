import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { worktreeCmd } from "#command/worktree/index";
import { Session } from "#core/session";
import { Worktrees } from "#core/worktree/index";
import { MemoryModule } from "#module/memory/index";
import { implementInNewSession } from "#module/plan-build/commands/plan/implement";
import { PlanBuildModule } from "#module/plan-build/index";
import { registerRules } from "#rule/index";
import { fakeSession } from "../fakes";

const execute = promisify(execFile);

let root: string;
let main: string;
let active: { session: Session; ctx: ExtensionCommandContext; manager: SessionManager };
let cancel: boolean;

async function git(cwd: string, ...args: string[]) {
  return (await execute("git", args, { cwd })).stdout.trim();
}

function conversation(cwd: string, text: string) {
  const manager = SessionManager.create(cwd);
  manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  return manager;
}

/** Makes `manager` the live session, the way pi does after a switch: a new context and a new MyPi `Session`. */
async function activate(manager: SessionManager) {
  const base = fakeSession([], manager.getCwd()).session;
  vi.mocked(base.ctx.ui.select).mockResolvedValue("Keep");
  const ctx = {
    ...base.ctx,
    sessionManager: manager,
    waitForIdle: vi.fn(async () => {}),
    sendUserMessage: async () => {},
    newSession: async (options: Parameters<ExtensionCommandContext["newSession"]>[0]) => {
      const next = SessionManager.create(manager.getCwd(), undefined, { parentSession: options?.parentSession });
      await options?.setup?.(next);
      await activate(next);
      return { cancelled: false };
    },
    switchSession: vi.fn<ExtensionCommandContext["switchSession"]>(async (file, options) => {
      if (cancel) return { cancelled: true };
      await activate(SessionManager.open(file));
      await options?.withSession?.(active.ctx as never);
      return { cancelled: false };
    }),
  } as unknown as ExtensionCommandContext;
  const pi = { ...base.pi, appendEntry: (type: string, data: unknown) => manager.appendCustomEntry(type, data) };
  const session = new Session(ctx, pi, await new Worktrees(ctx.cwd).project());
  active = { session, ctx, manager };
}

async function command(...args: string[]) {
  return worktreeCmd(active.session).execute(active.ctx, args);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mypi-worktree-command-")));
  vi.stubEnv("PI_CODING_AGENT_DIR", join(root, "agent"));
  main = join(root, "main");
  await mkdir(main);
  await git(main, "init", "-b", "main");
  await writeFile(join(main, "file"), "base");
  await git(main, "add", ".");
  await git(main, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "base");
  cancel = false;
  await activate(conversation(main, "A"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe("/worktree", () => {
  it("enters with a fork of the selected branch, whose parent is the entering session", async () => {
    const a = active.manager;
    const selected = a.appendCustomEntry("selected", {});
    a.appendCustomEntry("abandoned", {});
    a.branch(selected);

    await command("enter", "task");

    expect(active.ctx.cwd).toBe(join(main, ".pi/worktrees/task"));
    expect(active.manager.getHeader()?.parentSession).toBe(a.getSessionFile());
    expect(JSON.stringify(active.manager.getBranch())).not.toContain("abandoned");
  });

  it("exits to the entering session, without the worktree's messages", async () => {
    const a = active.manager;
    await command("enter", "task");
    active.manager.appendMessage({ role: "user", content: "worktree-only", timestamp: Date.now() });

    await command("exit");

    expect(active.manager.getSessionId()).toBe(a.getSessionId());
    expect(JSON.stringify(active.manager.getBranch())).not.toContain("worktree-only");
  });

  it("re-enters the worktree's own session and exits to whoever re-entered", async () => {
    await command("enter", "task");
    const worktreeId = active.manager.getSessionId();
    await command("exit");
    const b = conversation(main, "B");
    await activate(b);

    await command("enter", "task");
    expect(active.manager.getSessionId()).toBe(worktreeId);
    await command("exit");
    expect(active.manager.getSessionId()).toBe(b.getSessionId());
  });

  it("exits through a /plan implement session to the entering one", async () => {
    const origin = active.manager.getSessionFile();
    await command("enter", "task");
    const plan = join(root, "plan.md");
    await writeFile(plan, "# Plan");
    await implementInNewSession(active.ctx, plan, () => {});

    await command("exit");

    expect(active.manager.getSessionFile()).toBe(origin);
  });

  it("refuses to exit a session with no parent, such as a bare /new", async () => {
    await command("enter", "task");
    await activate(conversation(active.ctx.cwd, "bare new"));
    await expect(command("exit")).rejects.toThrow("bare /new");
  });

  it("forks again for a new checkout under a removed one's name", async () => {
    await command("enter", "task");
    const oldId = active.manager.getSessionId();
    await command("exit", "remove");

    await command("enter", "task");

    expect(active.manager.getSessionId()).not.toBe(oldId);
  });

  it("refuses to nest worktrees", async () => {
    await command("enter", "task");
    expect(await command("enter", "task")).toBe("Already in worktree task.");
    await expect(command("enter", "other")).rejects.toThrow("exit first");
  });

  it("refuses to switch while a job runs", async () => {
    let finish = () => {};
    const job = active.session.jobs.start({
      kind: "test",
      label: "running",
      run: () => new Promise<number>((resolve) => (finish = () => resolve(0))),
    });

    await expect(command("enter", "task")).rejects.toThrow("running jobs");

    finish();
    await job.done;
  });

  it("removes a clean worktree after returning", async () => {
    await command("enter", "task");
    const path = active.ctx.cwd;

    await command("exit", "remove");

    expect(active.ctx.cwd).toBe(main);
    await expect(readFile(join(path, "file"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns but keeps a worktree with changes, saying why", async () => {
    await command("enter", "task");
    const path = active.ctx.cwd;
    await writeFile(join(path, "file"), "work");
    vi.mocked(active.ctx.ui.select).mockResolvedValueOnce("Remove");

    await command("exit");

    expect(active.ctx.cwd).toBe(main);
    expect(await readFile(join(path, "file"), "utf8")).toBe("work");
    expect(active.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("would be lost"), "warning");
  });

  it("stays when the exit dialog is cancelled", async () => {
    await command("enter", "task");
    vi.mocked(active.ctx.ui.select).mockResolvedValueOnce("Cancel");

    expect(await command("exit")).toBe("Exit cancelled.");
    expect(active.ctx.cwd).toBe(join(main, ".pi/worktrees/task"));
  });

  it("refuses a second command while a switch runs", async () => {
    let idle = () => {};
    vi.mocked(active.ctx.waitForIdle).mockReturnValueOnce(new Promise<void>((resolve) => (idle = resolve)));
    const cmd = worktreeCmd(active.session);
    const pending = cmd.execute(active.ctx, ["enter", "task"]);

    await expect(cmd.execute(active.ctx, ["list"])).rejects.toThrow("still running");

    idle();
    await pending;
  });

  it.each([[["enter"]], [["exit", "discard"]], [["remove"]], [["rename"]]])("shows usage for %j", async (args) => {
    await expect(command(...args)).rejects.toThrow("Use /worktree");
  });

  // Memories and plans belong to the project, not a branch, so every checkout uses the main checkout's folders.
  it("lets a worktree session write only the main checkout's memories and plans", async () => {
    const { session } = fakeSession([], "/repo/.pi/worktrees/task", { main: "/repo", commonDir: "/repo/.git" });
    registerRules(session);
    new MemoryModule(session).init();
    new PlanBuildModule(session).init();
    const write = (path: string) =>
      session.toolGuard.check(
        { type: "tool_call", toolCallId: path, toolName: "write", input: { path, content: "x" } },
        { ...session.ctx, hasUI: false },
      );

    await expect(write("/repo/.pi/memories/a.md")).resolves.toBeUndefined();
    await expect(write("/repo/.pi/plans/a.md")).resolves.toBeUndefined();
    await expect(write("/repo/file")).resolves.toMatchObject({ block: true });
  });
});
