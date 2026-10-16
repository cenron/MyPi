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

/** Opens the module modal. Save stores the selection and asks for `/reload`; Escape shows nothing. Needs TUI mode. */
const openModal = async (ctx: ExtensionCommandContext, session: Session): Promise<string | undefined> => {
  const selected = await openModulesModal(ctx, session);

  if (selected === undefined) return undefined; // Escape: show nothing

  const loadedNames = session.moduleManager.select(selected);

  session.logWarning(`Need to /reload to enable/disable modules \n\t${loadedNames.join("\n\t")}`);

  return "";
};

/** Every module, one per line, as `loaded: <name>` or `not loaded: <name>` (what's running, not the selection). */
const listModules = (session: Session): string =>
  session.moduleManager.moduleInfos
    .map((module) => `${module.isLoaded ? "loaded" : "not loaded"}: ${module.name}`)
    .join("\n");
