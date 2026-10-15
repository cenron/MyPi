import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import type { Command } from "#core/types";
import { openModulesModal } from "#ui/modules-modal";

export function modulesCmd(session: Session): Command {
  return {
    info: {
      name: "modules",
      description: "Choose which modules load (list: print them)",
    },
    execute: (ctx: ExtensionCommandContext, args: string[]) => {
      const [subcommand, ..._rest] = args;

      switch (subcommand) {
        case "list":
          return listModules(session);
        case undefined:
          return openModal(ctx, session);
        default:
          throw new Error(`Unknown subcommand: ${subcommand}`);
      }
    },
  };
}

/** Opens the module modal and reports the saved selection; Escape shows nothing. Needs TUI mode. */
const openModal = async (
  ctx: ExtensionCommandContext,
  session: Session,
): Promise<string | undefined> => {
  const selected = await openModulesModal(ctx, session);

  if (selected === undefined) return undefined; // Escape: show nothing
  return `Selected: ${selected.join(", ") || "none"}`; // Save
};

/** One module name per line. */
const listModules = (session: Session): string => {
  return session.modules.map((m) => m.name).join("\n");
};
