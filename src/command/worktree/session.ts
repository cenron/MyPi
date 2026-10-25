import { realpath } from "node:fs/promises";
import { type ExtensionCommandContext, type ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import { isRecord } from "#core/util/guards";
import { isInside } from "#core/util/paths";
import type { Worktree } from "#core/worktree/git";
import { type Inspection, Worktrees } from "#core/worktree/index";

/** Saved in the worktree's session on re-entry, naming the conversation exit returns to. */
const ORIGIN = "worktree-origin";

/** What `/worktree exit` does with the checkout once it's back in the origin. */
export type ExitChoice = "keep" | "remove";

const EXIT_LABELS = new Map<string, ExitChoice>([
  ["Keep", "keep"],
  ["Remove", "remove"],
]);

type ReadableSession = ExtensionCommandContext["sessionManager"];

/**
 * Moves this conversation into worktree `name`, creating it if needed: a fork of the conversation on first entry, the
 * worktree's own latest session after that. Only a command can switch sessions, and after the switch `ctx` and
 * `session` belong to the old one, so nothing uses them then.
 */
export async function enterWorktree(session: Session, ctx: ExtensionCommandContext, name: string) {
  await ctx.waitForIdle();
  requireNoJobs(session);

  const entries = await session.worktrees.list();
  const current = await currentWorktree(entries, ctx.cwd);
  if (current) {
    if (current.managedName === name) return `Already in worktree ${name}.`;
    throw new Error(`Already in worktree ${current.managedName}; use /worktree exit first.`);
  }

  const source = ctx.sessionManager.getSessionFile();
  if (!source) throw new Error("Send a prompt first: entering needs a saved conversation.");

  // A saved entry makes the selected branch the session file's last one, which a fork and a return both pick up.
  session.save("worktree-anchor", {});
  const existing = entries.find((entry) => entry.managedName === name);
  const target = existing
    ? await resumeSession(session, source, existing.path)
    : forkSession(source, (await session.worktrees.create(name)).path);

  const result = await ctx.switchSession(target, {
    withSession: async (fresh) => notify(fresh, `Entered worktree ${name}.`),
  });
  return result.cancelled ? "Entry cancelled." : undefined;
}

/** Returns to the conversation that entered this worktree, then keeps the checkout or safely removes it. */
export async function exitWorktree(session: Session, ctx: ExtensionCommandContext, choice?: ExitChoice) {
  await ctx.waitForIdle();
  requireNoJobs(session);

  const current = await currentWorktree(await session.worktrees.list(), ctx.cwd);
  if (!current?.managedName) throw new Error("Not in a MyPi worktree; nothing to exit.");
  const name = current.managedName;

  const action = choice ?? (await askExit(ctx, await session.worktrees.inspect(name)));
  if (!action) return "Exit cancelled.";

  const origin = await findOrigin(ctx.sessionManager, current.path);
  session.save("worktree-anchor", {});
  const result = await ctx.switchSession(origin, { withSession: (fresh) => finishExit(fresh, name, action) });
  return result.cancelled ? "Exit cancelled." : undefined;
}

/** The session to return to: the latest origin entry, else the first session up the parent chain outside `worktree`. */
export async function findOrigin(start: ReadableSession, worktree: string): Promise<string> {
  let current = start;
  while (true) {
    const file = nextSessionFile(current);
    const next = SessionManager.open(file);
    if (!isInside(worktree, await realpath(next.getCwd()))) return file;

    current = next;
  }
}

/**
 * The worktree's latest session, with this conversation saved as where to return. A fork when it has none. A new
 * checkout always forks, even under a name an old, removed one used.
 */
async function resumeSession(session: Session, source: string, path: string): Promise<string> {
  const [latest] = (await SessionManager.list(path)).sort((a, b) => b.modified.getTime() - a.modified.getTime());
  if (!latest) return forkSession(source, path);

  session.saveTo(SessionManager.open(latest.path), ORIGIN, { file: source });
  return latest.path;
}

/** A copy of the conversation in `source`, rooted in `path`; pi records `source` as its parent. */
function forkSession(source: string, path: string): string {
  const file = SessionManager.forkFrom(source, path).getSessionFile();
  if (!file) throw new Error(`pi made no session file for ${path}.`);
  return file;
}

function nextSessionFile(manager: ReadableSession): string {
  const origin = [...manager.getBranch()]
    .reverse()
    .find((entry) => entry.type === "custom" && entry.customType === `mypi-${ORIGIN}`);
  if (origin?.type === "custom" && isRecord(origin.data) && typeof origin.data.file === "string") {
    return origin.data.file;
  }

  const parent = manager.getHeader()?.parentSession;
  if (!parent) {
    throw new Error("No conversation to return to: this session has no parent (a bare /new starts over). Use /resume.");
  }
  return parent;
}

async function askExit(ctx: ExtensionCommandContext, { worktree, blockers }: Inspection) {
  if (!ctx.hasUI) return "keep";

  const removal = blockers.length
    ? `Remove would refuse, for:\n${blockers.join("\n")}`
    : "No changes, so Remove is safe.";
  const answer = await ctx.ui.select(`Leave worktree ${worktree.managedName}?\n${removal}`, [
    "Keep",
    "Remove",
    "Cancel",
  ]);
  return EXIT_LABELS.get(answer ?? "");
}

async function finishExit(ctx: ExtensionContext, name: string, action: ExitChoice) {
  if (action === "keep") return notify(ctx, `Back; worktree ${name} kept.`);

  try {
    const removed = await new Worktrees(ctx.cwd).remove(name);
    notify(
      ctx,
      `Back; worktree ${name} removed. ${removed.branchDeleted ? `Deleted ${removed.branch}.` : removed.reason}`,
    );
  } catch (error) {
    notify(ctx, `Back; worktree ${name} kept: ${errorMessage(error)}`, "warning");
  }
}

async function currentWorktree(entries: Worktree[], cwd: string): Promise<Worktree | undefined> {
  const path = await realpath(cwd);
  return entries.find((entry) => entry.managedName && isInside(entry.path, path));
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" = "info") {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}

function requireNoJobs(session: Session): void {
  const running = session.jobs.list().filter((job) => job.status === "running");
  if (running.length) {
    throw new Error(
      `Stop or wait for running jobs first: ${running.map((job) => `${job.id} (${job.label})`).join(", ")}.`,
    );
  }
}
