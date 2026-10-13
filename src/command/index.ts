import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import { myPiCmd } from "./mypi.ts";
import type { Command } from "./types.ts";

export function registerCommand(pi: ExtensionAPI, session: Session) {
  for (const cmd of createCommand(session)) {
    pi.registerCommand(cmd.name, {
      description: cmd.description,
      handler: async (args: string, ctx: ExtensionCommandContext) =>
        await runCommand(cmd, args, ctx),
    });
  }
}
const createCommand = (session: Session): Command[] => {
  return [myPiCmd(session)];
};

const runCommand = async (
  cmd: Command,
  args: string,
  ctx: ExtensionCommandContext,
) => {
  try {
    const message = await cmd.execute(splitArgs(args));
    if (message) ctx.ui.notify(message, "info");
  } catch (error) {
    ctx.ui.notify(errorMessage(error), "error");
  }
};

const splitArgs = (args: string): string[] =>
  args.trim().split(/\s+/).filter(Boolean);
