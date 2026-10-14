import type { Session } from "#core/session";
import type { Command } from "#core/types";

export function modulesCmd(session: Session): Command {
  return {
    info: {
      name: "modules",
      description: "Returns a list of loaded modules",
    },
    execute: (args: string[]) => {
      const [subcommand = "list", ..._rest] = args;

      switch (subcommand) {
        case "list":
          return listModules(session);
        default:
          throw new Error(`Unknown subcommand: ${subcommand}`);
      }
    },
  };
}

const listModules = (session: Session): string => {
  return session.modules.map((m) => m.name).join("\n");
};
