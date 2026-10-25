import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { modulesCmd } from "./modules";
import { worktreeCmd } from "./worktree";

/** Registers MyPi's own commands, then the running modules', each wrapped in `runCommand`. */
export function registerCommands(pi: ExtensionAPI, session: Session) {
  // Load the built-in commands, and only those from loaded modules.
  const commandList = [...createCommands(session), ...session.moduleManager.getCommands()];

  for (const cmd of commandList) {
    pi.registerCommand(cmd.info.name, {
      description: cmd.info.description,
      handler: (args, ctx) => runCommand(cmd, args, ctx, session),
    });
  }
}

/** MyPi's own commands. Add new ones here. */
function createCommands(session: Session): Command[] {
  return [modulesCmd(session), worktreeCmd(session)];
}

/**
 * Runs a command, shows its returned message as `info`, and turns a thrown error into an `error` notification, both
 * through `Session`, which skips them when there's no UI.
 */
async function runCommand(cmd: Command, args: string, ctx: ExtensionCommandContext, session: Session) {
  try {
    const message = await cmd.execute(ctx, splitArgs(args));
    if (message) session.log(message);
  } catch (error) {
    try {
      session.logError(errorMessage(error));
    } catch {
      // Replacement can invalidate the notifier too. Let pi report the original failure, not a stale-context error.
      throw error;
    }
  }
}

/** Splits pi's raw argument string on whitespace, dropping empty parts. */
function splitArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}
