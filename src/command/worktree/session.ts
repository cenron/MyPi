import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { type ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import { isRecord } from "#core/util/guards";
import { isInside } from "#core/util/paths";
import { validateName, type Worktree } from "#core/worktree/git";

const ORIGIN = "worktree-origin";

/** Commands alone replace sessions. Capture plain paths before switching; never use the old Session afterward. */
export async function enterWorktree(session: Session, ctx: ExtensionCommandContext, name: string) {
  validateName(name);
  await ctx.waitForIdle();
  requireNoJobs(session);

  const entries = await session.worktrees.list();
  const cwd = await realpath(ctx.cwd);
  const current = entries.find((entry) => entry.managedName && isInside(entry.path, cwd));
  if (current) {
    if (current.managedName === name) return `Already in worktree ${name}.`;
    throw new Error(`Already in worktree ${current.managedName}; use /worktree exit before entering another.`);
  }

  const sourceFile = ctx.sessionManager.getSessionFile();
  if (!sourceFile) throw new Error("Entering requires a saved conversation; send a prompt first, then retry.");
  const source = await openSession(sourceFile);
  if ((await realpath(source.getCwd())) !== cwd) {
    throw new Error("Source session changed; resume the intended conversation before entering.");
  }

  const existing = entries.find((entry) => entry.managedName === name);
  const target = await targetWorktree(session, name, existing);

  session.save("worktree-anchor", {});
  const targetFile = await targetSession(session, sourceFile, target, existing);

  const result = await ctx.switchSession(targetFile, {
    withSession: async (fresh) => {
      if (fresh.hasUI) fresh.ui.notify(`Entered worktree ${name}: ${fresh.cwd}`, "info");
    },
  });
  return result.cancelled
    ? `Entry cancelled; checkout ${target.path} and session ${targetFile} were retained.`
    : undefined;
}

export async function exitWorktree(session: Session, ctx: ExtensionCommandContext) {
  await ctx.waitForIdle();
  requireNoJobs(session);

  const cwd = await realpath(ctx.cwd);
  const entry = (await session.worktrees.list()).find((entry) => entry.managedName && isInside(entry.path, cwd));
  if (!entry) throw new Error("This session is not in a MyPi-managed worktree; nothing to exit.");

  // Ownership/storage checks still apply to a dirty target, but changes never block returning and keeping it.
  await session.worktrees.inspect(entry.managedName ?? "");
  const origin = await findOrigin(ctx.sessionManager, entry.path);

  session.save("worktree-anchor", {});
  const result = await ctx.switchSession(origin, {
    withSession: async (fresh) => {
      if (fresh.hasUI) {
        fresh.ui.notify(`Returned to ${fresh.cwd}; worktree ${entry.managedName} kept at ${entry.path}.`, "info");
      }
    },
  });
  return result.cancelled ? "Exit cancelled; still in the worktree. Nothing was removed." : undefined;
}

/** Latest branch-scoped override wins; native parent links carry clear-context planning sessions back to it. */
export async function findOrigin(
  current: ExtensionCommandContext["sessionManager"],
  worktree: string,
): Promise<string> {
  const seen = new Set<string>();
  let manager = current;

  while (true) {
    const { file: target, override } = nextSessionFile(manager);
    const file = manager.getSessionFile();
    if (file) seen.add(await realpath(file));

    if (typeof target !== "string" || !isAbsolute(target)) {
      throw new Error("Invalid worktree origin or parent entry; inspect this session's history.");
    }

    const next = await openSession(target);
    const nextFile = next.getSessionFile();
    if (!nextFile || seen.has(nextFile)) {
      throw new Error("Cycle in worktree session origins; inspect the session history.");
    }

    if (!isInside(worktree, await realpath(next.getCwd()))) return nextFile;
    if (override) {
      throw new Error("Worktree origin must be outside the worktree; inspect the origin entry.");
    }

    manager = next;
  }
}

async function targetWorktree(session: Session, name: string, existing: Worktree | undefined): Promise<Worktree> {
  if (existing) return (await session.worktrees.inspect(name)).worktree;
  return (await session.worktrees.create(name)).worktree;
}

async function targetSession(
  session: Session,
  source: string,
  target: Worktree,
  existing: Worktree | undefined,
): Promise<string> {
  const recent = existing
    ? (await SessionManager.list(target.path)).sort((a, b) => b.modified.getTime() - a.modified.getTime())[0]
    : undefined;
  const manager = recent ? await openSession(recent.path) : SessionManager.forkFrom(source, target.path);
  if ((await realpath(manager.getCwd())) !== (await realpath(target.path))) {
    throw new Error(`Session cwd does not match worktree ${target.managedName}; inspect ${manager.getSessionFile()}.`);
  }

  if (recent) session.saveTo(manager, ORIGIN, { file: source });
  const file = manager.getSessionFile();
  if (!file) throw new Error(`No session file for ${target.path}; inspect the checkout.`);
  return file;
}

function nextSessionFile(manager: ExtensionCommandContext["sessionManager"]) {
  const override = [...manager.getBranch()]
    .reverse()
    .find((entry) => entry.type === "custom" && entry.customType === `mypi-${ORIGIN}`);
  if (override?.type === "custom") {
    return { file: isRecord(override.data) ? override.data.file : undefined, override: true };
  }

  const parent = manager.getHeader()?.parentSession;
  if (!parent) {
    throw new Error(
      "No worktree origin: this session has no parent or origin entry (a bare /new breaks the chain). Resume the originating conversation explicitly; nothing was switched.",
    );
  }
  return { file: parent, override: false };
}

async function openSession(file: string): Promise<SessionManager> {
  try {
    const path = await realpath(file);
    const manager = SessionManager.open(path);
    const cwd = manager.getHeader()?.cwd;
    if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new Error("session cwd must be absolute");
    if (!(await stat(cwd)).isDirectory()) throw new Error("session cwd is not a directory");

    return manager;
  } catch (error) {
    throw new Error(
      `Cannot open session ${JSON.stringify(file)}: ${errorMessage(error)}. Resume or repair the intended session explicitly.`,
      { cause: error },
    );
  }
}

function requireNoJobs(session: Session): void {
  const jobs = session.jobs.list().filter((job) => job.status === "running");
  if (jobs.length) {
    throw new Error(
      `Wait for or stop running jobs before switching: ${jobs.map((job) => `${job.id} (${job.label})`).join(", ")}.`,
    );
  }
}
