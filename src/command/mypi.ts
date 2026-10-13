import type { Session } from "#core/session";
import type { Command } from "./types.ts";

export function myPiCmd(session: Session): Command {
  return {
    name: "myPi",
    description: "Returns the value of pi",
    execute: (_args: string[]) => {
      session.log_error("myPi command executed");
      return "3.141592653589793";
    },
  };
}
