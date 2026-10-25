import { realpath } from "node:fs/promises";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { isInside } from "#core/util/paths";
import type { Worktree } from "#core/worktree/git";
import { enterWorktree, exitWorktree } from "./session";

const USAGE =
  "Use /worktree enter <name>, exit [keep], list, or remove <name>. Exit keeps the checkout; no discard option.";

/** Built-in user commands, not model tools: only command contexts can replace pi sessions. */
export function worktreeCmd(session: Session): Command {
  let switching = false;
  return {
    info: { name: "worktree", description: "Enter, leave, list, or safely remove a Git worktree" },
    async execute(ctx, args) {
      if (switching) throw new Error("A worktree switch is already pending; wait for it to finish.");
      const [action, name] = args;
      switch (action) {
        case "enter":
          if (args.length !== 2 || !name) throw new Error(USAGE);
          return switchWorktree(() => enterWorktree(session, ctx, name));
        case "exit":
          if (args.length !== 1 && !(args.length === 2 && name === "keep")) throw new Error(USAGE);
          return switchWorktree(() => exitWorktree(session, ctx));
        case "remove":
          if (args.length !== 2 || !name) throw new Error(USAGE);
          return removeWorktree(session, name);
        case "list":
          if (args.length !== 1) throw new Error(USAGE);
          return listWorktrees(session, ctx);
        case undefined:
          return `${await listWorktrees(session, ctx)}\n${USAGE}`;
        default:
          throw new Error(USAGE);
      }
    },
  };

  async function switchWorktree(switchSession: () => Promise<string | undefined>) {
    switching = true;
    try {
      return await switchSession();
    } finally {
      switching = false;
    }
  }
}

async function removeWorktree(session: Session, name: string): Promise<string> {
  const result = await session.worktrees.remove(name);
  return `Removed ${result.path}. ${result.branchDeleted ? `Deleted ${result.branch}.` : result.reason}`;
}

async function listWorktrees(session: Session, ctx: ExtensionCommandContext): Promise<string> {
  const entries = await session.worktrees.list();
  const cwd = await realpath(ctx.cwd);
  const current = entries
    .filter((entry) => isInside(entry.path, cwd))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path;

  return entries.map((entry) => worktreeLine(entry, current)).join("\n");
}

function worktreeLine(entry: Worktree, current: string | undefined): string {
  const flags = [
    entry.primary ? "primary" : entry.managedName ? `managed: ${entry.managedName}` : "external",
    entry.path === current ? "current" : undefined,
    entry.detached ? "detached" : undefined,
    entry.bare ? "bare" : undefined,
    entry.locked !== undefined ? `locked: ${entry.locked}` : undefined,
    entry.prunable !== undefined ? `prunable: ${entry.prunable}` : undefined,
  ].filter(Boolean);
  return `${JSON.stringify(entry.path)} (${flags.join(", ")}) ${entry.branch ?? entry.head ?? ""}`;
}
