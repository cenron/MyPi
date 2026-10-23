import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { modulesCmd } from "./modules";

/** Registers MyPi's own commands, then the running modules', each wrapped in `runCommand`. */
export function registerCommand(pi: ExtensionAPI, session: Session) {
  // Load the built-in commands, and only those from loaded modules.
  const commandList = [...createCommand(session), ...session.moduleManager.getCommands()];

  for (const cmd of commandList) {
    pi.registerCommand(cmd.info.name, {
      description: cmd.info.description,
      handler: (args, ctx) => runCommand(cmd, args, ctx),
    });
  }
}

/** MyPi's own commands. Add new ones here. */
function createCommand(session: Session): Command[] {
  return [modulesCmd(session)];
}

/** Runs a command, shows its returned message as `info`, and turns a thrown error into an `error` notification. */
async function runCommand(cmd: Command, args: string, ctx: ExtensionCommandContext) {
  try {
    const message = await cmd.execute(ctx, splitArgs(args));
    if (message) ctx.ui.notify(message, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error), "error");
  }
}

/** Splits pi's raw argument string on whitespace, dropping empty parts. */
function splitArgs(args: string): string[] {
  return args.trim().split(/\s+/).filter(Boolean);
}
