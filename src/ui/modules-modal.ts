import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import { openToggleDialog } from "./components/toggle-dialog";

/**
 * Opens the module dialog as a centered overlay. Resolves to the selected names in list order on Save, or `undefined`
 * on Escape.
 */
export async function openModulesModal(ctx: ExtensionContext, session: Session): Promise<Set<string> | undefined> {
  if (ctx.mode !== "tui") throw new Error("/modules requires TUI mode");

  const modules = session.moduleManager.moduleInfos;
  const on = await openToggleDialog(
    ctx,
    "Modules",
    modules.map((info) => ({
      id: info.name,
      label: info.name,
      description: info.description,
      on: info.isSelected ?? false,
      disabled: info.loadType === ModuleLoadMode.ALWAYS,
    })),
  );
  return on && new Set(modules.filter((info) => on.has(info.name)).map((info) => info.name));
}
