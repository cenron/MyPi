import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Dialog } from "./dialog";
import { type ToggleItem, ToggleList } from "./toggle-list";

/** Opens the shared centered toggle dialog; changes stay local until Save. */
export async function openToggleDialog(
  ctx: ExtensionContext,
  title: string,
  items: ToggleItem[],
): Promise<Set<string> | undefined> {
  return ctx.ui.custom<Set<string> | undefined>(
    (_tui, theme: Theme, _keybindings, done) => {
      const on = new Set(items.filter((item) => item.on).map((item) => item.id));
      const dialog = new Dialog(theme, { title });
      dialog.addChild(
        new ToggleList(theme, items, {
          onToggle: (id, enabled) => (enabled ? on.add(id) : on.delete(id)),
          onAccept: () => done(on),
          onCancel: () => done(undefined),
        }),
      );
      return dialog;
    },
    { overlay: true, overlayOptions: { anchor: "center", width: 100, maxHeight: "70%" } },
  );
}
