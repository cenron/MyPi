import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { Command } from "#core/types";

export function myPiCmd(_session: Session): Command {
  return {
    info: {
      name: "myPi",
      description: "Returns the value of pi",
    },
    execute: (_ctx: ExtensionCommandContext, _args: string[]) => {
      return "3.141592653589793";
    },
  };
}
