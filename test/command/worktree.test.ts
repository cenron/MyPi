import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { worktreeCmd } from "#command/worktree/index";
import { findOrigin } from "#command/worktree/session";
import { Session } from "#core/session";
import { Worktrees } from "#core/worktree/index";
import { implementInNewSession } from "#module/plan-build/commands/plan/implement";
import { fakeSession } from "../fakes";

type SwitchOptions = NonNullable<Parameters<ExtensionCommandContext["switchSession"]>[1]>;
type FreshContext = Parameters<NonNullable<SwitchOptions["withSession"]>>[0];

const execute = promisify(execFile);
let root: string;
let main: string;
let active: { session: Session; ctx: FreshContext; manager: SessionManager };
let cancel: boolean;
async function git(cwd: string, ...args: string[]) {
  return (await execute("git", args, { cwd })).stdout.trim();
}
function conversation(cwd: string, text: string, parentSession?: string) {
  const manager = SessionManager.create(cwd, undefined, { parentSession });
  manager.appendMessage({ role: "user", content: text, timestamp: Date.now() });
  return manager;
}
async function activate(manager: SessionManager) {
  const base = fakeSession([], manager.getCwd()).session;
  const ctx = {
    ...base.ctx,
    sessionManager: manager,
    waitForIdle: vi.fn(async () => {}),
    sendMessage: async () => {},
    sendUserMessage: async (content: string) => {
      manager.appendMessage({ role: "user", content, timestamp: Date.now() });
    },
    newSession: async (options: Parameters<ExtensionCommandContext["newSession"]>[0]) => {
      const next = SessionManager.create(manager.getCwd(), undefined, { parentSession: options?.parentSession });
      await options?.setup?.(next);
      await activate(next);
      await options?.withSession?.(active.ctx);
      return { cancelled: false };
    },
    switchSession: vi.fn<ExtensionCommandContext["switchSession"]>(async (file, options) => {
      if (cancel) return { cancelled: true };
      await activate(SessionManager.open(file));
      await options?.withSession?.(active.ctx);
      return { cancelled: false };
    }),
  } as unknown as FreshContext;
  const session = new Session(
    ctx,
    {
      ...base.pi,
      appendEntry: (type, data) => {
        manager.appendCustomEntry(type, data);
      },
    },
    await new Worktrees(ctx.cwd).project(),
  );
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
  it("forks the selected branch", async () => {
    const a = active.manager;
    const selected = a.appendCustomEntry("selected-A", {});
    a.appendCustomEntry("other-branch", {});
    a.branch(selected);
    await command("enter", "task");
    expect(active.manager.getSessionId()).not.toBe(a.getSessionId());
    expect(active.manager.getHeader()?.parentSession).toBe(a.getSessionFile());
    expect(
      active.manager.getBranch().some((entry) => entry.type === "custom" && entry.customType === "other-branch"),
    ).toBe(false);
  });

  it("returns without merging worktree history", async () => {
    const a = active.manager;
    const selected = a.appendCustomEntry("selected-A", {});
    a.appendCustomEntry("other-branch", {});
    a.branch(selected);
    await command("enter", "task");
    const path = active.ctx.cwd;
    active.manager.appendMessage({ role: "user", content: "worktree-only", timestamp: Date.now() });
    await writeFile(join(path, "file"), "dirty work retained");
    await command("exit");
    expect(active.manager.getSessionId()).toBe(a.getSessionId());
    expect(JSON.stringify(active.manager.getBranch())).not.toContain("worktree-only");
    expect(JSON.stringify(active.manager.getBranch())).not.toContain("other-branch");
  });

  it("re-enters its own history from B and returns to B", async () => {
    await command("enter", "task");
    const path = active.ctx.cwd;
    const targetId = active.manager.getSessionId();
    active.manager.appendMessage({ role: "user", content: "worktree-only", timestamp: Date.now() });
    await writeFile(join(path, "file"), "dirty work retained");
    await command("exit");

    const b = conversation(main, "B");
    await activate(b);
    await command("enter", "task");
    expect(active.manager.getSessionId()).toBe(targetId);
    expect(JSON.stringify(active.manager.getBranch())).toContain("worktree-only");
    expect(await readFile(join(path, "file"), "utf8")).toBe("dirty work retained");
    await command("exit", "keep");
    expect(active.manager.getSessionId()).toBe(b.getSessionId());
    expect(active.ctx.cwd).toBe(main);
  });

  it("walks same-worktree parents", async () => {
    const origin = active.manager.getSessionFile();
    await command("enter", "task");
    const parent = active.manager.getSessionFile();
    const plan = join(root, "plan.md");
    await writeFile(plan, "# Test plan");
    await implementInNewSession(active.ctx, plan, (manager) => {
      manager.appendCustomEntry("mypi-module-plan-build", { mode: "build" });
    });
    expect(active.manager.getHeader()?.parentSession).toBe(parent);
    await command("exit");
    expect(active.manager.getSessionFile()).toBe(origin);
  });

  it("refuses a parentless /new until explicit re-entry seeds an origin", async () => {
    await command("enter", "task");
    await activate(conversation(active.ctx.cwd, "bare new"));
    await expect(command("exit")).rejects.toThrow("bare /new");
    // No saved mapping is required: a deliberate re-entry gives this newest conversation a valid origin.
    const b = conversation(main, "B");
    await activate(b);
    await command("enter", "task");
    await command("exit");
    expect(active.manager.getSessionId()).toBe(b.getSessionId());
  });

  it("returns to an exact linked-checkout subdirectory origin", async () => {
    const caller = join(root, "caller");
    await git(main, "worktree", "add", "-b", "caller", caller);
    await mkdir(join(caller, "subdir"));
    const source = conversation(join(caller, "subdir"), "linked origin");
    await activate(source);
    await command("enter", "task");
    await command("exit");
    expect(active.ctx.cwd).toBe(join(caller, "subdir"));
    expect(active.manager.getSessionId()).toBe(source.getSessionId());
  });

  it("lists without creation", async () => {
    expect(await command("list")).toContain("primary, current");
    expect(await command()).toContain("/worktree enter");
  });

  it("validates command syntax", async () => {
    await expect(command("enter")).rejects.toThrow("Use /worktree");
    await expect(command("exit", "remove")).rejects.toThrow("Use /worktree");
  });

  it("prevents nested entry", async () => {
    await command("enter", "task");
    expect(await command("enter", "task")).toContain("Already in");
    await expect(command("enter", "nested")).rejects.toThrow("exit before entering");
  });

  it("removes a worktree through the command", async () => {
    await active.session.worktrees.create("task");
    expect(await command("remove", "task")).toContain("Deleted refs/heads/mypi/worktree/task");
  });

  it("refuses exit outside a managed worktree", async () => {
    await expect(command("exit")).rejects.toThrow("not in a MyPi-managed");
  });

  it("refuses running jobs after waiting for idle", async () => {
    let finish: (() => void) | undefined;
    const job = active.session.jobs.start({
      kind: "test",
      label: "running",
      run: () =>
        new Promise<number>((resolve) => {
          finish = () => resolve(0);
        }),
    });
    await expect(command("enter", "task")).rejects.toThrow("stop running jobs");
    expect(active.ctx.waitForIdle).toHaveBeenCalledOnce();
    finish?.();
    await job.done;
    await rm(job.info.logPath);
  });

  it("keeps entry artifacts after cancellation", async () => {
    cancel = true;
    expect(await command("enter", "task")).toContain("Entry cancelled");
    expect(active.ctx.cwd).toBe(main);
    expect((await active.session.worktrees.list()).some((entry) => entry.managedName === "task")).toBe(true);
  });

  it("stays in the worktree after exit cancellation", async () => {
    await command("enter", "task");
    cancel = true;
    expect(await command("exit")).toContain("Exit cancelled");
    expect(active.ctx.cwd).not.toBe(main);
  });

  it("refuses overlapping commands while waiting to switch", async () => {
    let finish: (() => void) | undefined;
    const idle = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(active.ctx.waitForIdle).mockReturnValueOnce(idle);
    const cmd = worktreeCmd(active.session);
    const pending = cmd.execute(active.ctx, ["enter", "task"]);
    await expect(cmd.execute(active.ctx, ["list"])).rejects.toThrow("switch is already pending");
    finish?.();
    await pending;
  });

  it("does not adopt historical sessions when a removed worktree name is recreated", async () => {
    await command("enter", "task");
    const oldId = active.manager.getSessionId();
    await command("exit");
    await command("remove", "task");
    await command("enter", "task");
    expect(active.manager.getSessionId()).not.toBe(oldId);
  });

  it.each([
    "missing",
    "invalid",
    "relative",
    "invalid-header",
    "missing-cwd",
    "file-cwd",
    "inside",
    "cycle",
    "broken-parent",
  ])("refuses a %s origin instead of guessing", async (kind) => {
    await command("enter", "task");
    const current = active.manager;
    if (kind === "broken-parent") {
      await activate(conversation(active.ctx.cwd, "broken", join(root, "missing")));
    } else {
      let file: unknown = join(root, "missing");
      if (kind === "invalid") file = 42;
      if (kind === "cycle") file = current.getSessionFile();
      if (kind === "inside") file = conversation(active.ctx.cwd, "inside").getSessionFile();
      if (kind === "relative") file = relative(process.cwd(), conversation(main, "outside").getSessionFile() ?? "");
      if (kind === "invalid-header") {
        const corrupt = join(root, "corrupt.jsonl");
        await writeFile(corrupt, "{}\n");
        file = corrupt;
      }
      if (kind === "missing-cwd") file = conversation(join(root, "missing-cwd"), "outside").getSessionFile();
      if (kind === "file-cwd") file = conversation(join(main, "file"), "outside").getSessionFile();
      current.appendCustomEntry("mypi-worktree-origin", { file });
    }
    await expect(command("exit")).rejects.toThrow(
      /Cannot open session|Invalid worktree origin|outside the worktree|Cycle/,
    );
    expect(active.ctx.cwd).not.toBe(main);
  });

  it.each([false, true])("uses the current branch's latest override (parent planning session: %s)", async (parent) => {
    const a = active.manager.getSessionFile();
    await command("enter", "task");
    const b = conversation(main, "B");
    active.manager.appendCustomEntry("mypi-worktree-origin", { file: a });
    const valid = active.manager.appendCustomEntry("mypi-worktree-origin", { file: b.getSessionFile() });
    active.manager.appendCustomEntry("mypi-worktree-origin", { file: "bad" });
    active.manager.branch(valid);
    if (parent) {
      // Persist the selected branch, as the worktree commands do before replacement.
      active.manager.appendCustomEntry("anchor", {});
      await activate(conversation(active.ctx.cwd, "implementation", active.manager.getSessionFile()));
    }
    expect(await findOrigin(active.manager, active.ctx.cwd)).toBe(b.getSessionFile());
  });
});
