import { realpath } from "node:fs/promises";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { isInside } from "#core/util/paths";
import type { Worktree } from "#core/worktree/git";
import { type ExitChoice, enterWorktree, exitWorktree } from "./session";

const USAGE = "Use /worktree enter <name>, exit [keep|remove], list, or remove <name>.";

/** `/worktree`: a command, not a model tool, since only a command can switch pi to another session. */
export function worktreeCmd(session: Session): Command {
  let switching = false;

  return {
    info: { name: "worktree", description: "Enter, leave, list, or remove a git worktree" },
    async execute(ctx, [action, name]) {
      if (switching) throw new Error("A worktree switch is still running; wait for it to finish.");

      switch (action) {
        case "enter":
          if (!name) throw new Error(USAGE);
          return switchWorktree(() => enterWorktree(session, ctx, name));
        case "exit":
          if (name && name !== "keep" && name !== "remove") throw new Error(USAGE);
          return switchWorktree(() => exitWorktree(session, ctx, name as ExitChoice | undefined));
        case "remove":
          if (!name) throw new Error(USAGE);
          return removeWorktree(session, name);
        case "list":
          return listWorktrees(session, ctx);
        case undefined:
          return `${await listWorktrees(session, ctx)}\n${USAGE}`;
        default:
          throw new Error(USAGE);
      }
    },
  };

  async function switchWorktree(run: () => Promise<string | undefined>) {
    switching = true;
    try {
      return await run();
    } finally {
      switching = false;
    }
  }
}

async function removeWorktree(session: Session, name: string): Promise<string> {
  const removed = await session.worktrees.remove(name);
  return `Removed worktree ${name}. ${removed.branchDeleted ? `Deleted ${removed.branch}.` : removed.reason}`;
}

async function listWorktrees(session: Session, ctx: ExtensionCommandContext): Promise<string> {
  const entries = await session.worktrees.list();
  const cwd = await realpath(ctx.cwd);
  // The deepest match: managed worktrees sit inside the main checkout.
  const [current] = entries.filter((entry) => isInside(entry.path, cwd)).sort((a, b) => b.path.length - a.path.length);

  return entries.map((entry) => worktreeLine(entry, entry === current)).join("\n");
}

function worktreeLine(entry: Worktree, current: boolean): string {
  const kind = entry.primary ? "main" : entry.managedName ? `mypi: ${entry.managedName}` : "other";
  return `${entry.path} (${kind}${current ? ", current" : ""}) ${entry.branch ?? entry.head ?? ""}`;
}
