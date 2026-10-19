import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { Dialog } from "./components/dialog";
import { ToggleList } from "./components/toggle-list";

/**
 * Opens the module dialog as a centred overlay. Resolves to the selected names in list order on Save, or `undefined`
 * on Escape.
 */
export async function openModulesModal(ctx: ExtensionContext, session: Session): Promise<Set<string> | undefined> {
  if (ctx.mode !== "tui") throw new Error("/modules requires TUI mode");

  return await ctx.ui.custom<Set<string> | undefined>(
    (_tui, theme: Theme, _keybindings, done) => modal(theme, done, session.moduleManager.moduleInfos),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 100,
        maxHeight: "70%",
      },
    },
  );
}

/** Builds the dialog. Toggles edit a local copy of the selected set, so nothing outside changes until Save. */
const modal = (theme: Theme, done: (selected: Set<string> | undefined) => void, modules: ModuleInfo[]) => {
  const container = new Dialog(theme, {
    title: "Modules",
  });

  const loaded = new Set(modules.filter((m) => m.isSelected).map((m) => m.name));

  const list = new ToggleList(
    theme,
    modules.map((m) => ({
      id: m.name,
      label: m.name,
      description: m.description,
      on: loaded.has(m.name),
      disabled: m.loadType === ModuleLoadMode.ALWAYS,
    })),
    {
      onToggle: (id, on) => (on ? loaded.add(id) : loaded.delete(id)),
      onAccept: () => done(new Set(modules.filter((m) => loaded.has(m.name)).map((m) => m.name))),
      onCancel: () => done(undefined),
    },
  );

  container.addChild(list);
  return container;
};
