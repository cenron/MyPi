import type { Session } from "#core/session";
import type { Command } from "#core/types";

export function myPiCmd(session: Session): Command {
  return {
    info: {
      name: "myPi",
      description: "Returns the value of pi",
    },
    execute: (_args: string[]) => {
      session.logError("myPi command executed");
      return "3.141592653589793";
    },
  };
}
