import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { errorMessage } from "#core/util/errors";
import type { Module } from "#module/module";
import { modulesCmd } from "./modules/index";
import { myPiCmd } from "./mypi";

/** Registers MyPi's own commands, then every module's, each wrapped in `runCommand`. */
export function registerCommand(
  pi: ExtensionAPI,
  session: Session,
  modules: Module[],
) {
  const commandList = [
    ...createCommand(session),
    ...modules.flatMap((module) => module.commands()),
  ];

  for (const cmd of commandList) {
    pi.registerCommand(cmd.info.name, {
      description: cmd.info.description,
      handler: async (args: string, ctx: ExtensionCommandContext) =>
        await runCommand(cmd, args, ctx),
    });
  }
}

/** MyPi's own commands. Add new ones here. */
const createCommand = (session: Session): Command[] => {
  return [myPiCmd(session), modulesCmd(session)];
};

/** Runs a command, shows its returned message as `info`, and turns a thrown error into an `error` notification. */
const runCommand = async (
  cmd: Command,
  args: string,
  ctx: ExtensionCommandContext,
) => {
  try {
    const message = await cmd.execute(ctx, splitArgs(args));
    if (message) ctx.ui.notify(message, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error), "error");
  }
};

/** Splits pi's raw argument string on whitespace, dropping empty parts. */
const splitArgs = (args: string): string[] =>
  args.trim().split(/\s+/).filter(Boolean);
