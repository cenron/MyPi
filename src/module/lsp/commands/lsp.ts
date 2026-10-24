import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Command } from "#core/types";
import type { ServerManager } from "../manager";
import { openLspMenu, statusLine } from "../menu";

/** `/lsp`: opens the server menu, or prints each server's state with `list`. `save` stores the off set. */
export function lspCmd(servers: ServerManager, save: (off: Set<string>) => void): Command {
  return {
    info: {
      name: "lsp",
      description: "Turn language servers on or off (list: print their state)",
    },
    execute: (ctx, args) => {
      const [subcommand] = args;

      switch (subcommand) {
        case "list":
          return servers.statuses().map(statusLine).join("\n");
        case undefined:
          return openMenu(ctx, servers, save);
        default:
          throw new Error(`Unknown subcommand: ${subcommand}`);
      }
    },
  };
}

/** Opens the menu. Save applies and stores the off set at once, no `/reload` needed; Escape shows nothing. */
async function openMenu(
  ctx: ExtensionCommandContext,
  servers: ServerManager,
  save: (off: Set<string>) => void,
): Promise<string | undefined> {
  const off = await openLspMenu(ctx, servers.statuses());
  if (off === undefined) return undefined;

  await servers.setOff(off);
  save(off);

  const offNames = servers.specs.filter((spec) => off.has(spec.id)).map((spec) => spec.language);
  return offNames.length > 0 ? `LSP servers off: ${offNames.join(", ")}` : "All LSP servers on";
}
