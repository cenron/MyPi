import type { ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";

/** Theme color that suits footer items. Each value is a pi `ThemeColor`, so a pi rename fails the typecheck here. */
export const FooterColor = {
  Accent: "accent",
  Success: "success",
  Warning: "warning",
  Error: "error",
  Muted: "muted",
  Dim: "dim",
  Text: "text",
} as const satisfies Record<string, ThemeColor>;

export type FooterColor = (typeof FooterColor)[keyof typeof FooterColor];

/** One footer label: plain text and a pi theme color name, applied when it's drawn. */
export type FooterItem = {
  text: string;
  color: FooterColor;
};

/**
 * MyPi's footer. Modules set items by a key, and it draws them, today through pi's status line, which pi sorts by key
 * under its own footer. It keeps the items itself, so a custom footer can later draw them without modules changing.
 */
export class Footer {
  private readonly items = new Map<string, FooterItem>();

  constructor(readonly ctx: ExtensionContext) {}

  /** Sets the item under `key`, or clears it with `undefined`. */
  set(key: string, item: FooterItem | undefined) {
    if (item) this.items.set(key, item);
    else this.items.delete(key);
    this.draw(key);
  }

  /** Draws one item as the `mypi-<key>` status. Print mode's `setStatus` does nothing, so no `hasUI` guard. */
  private draw(key: string) {
    const item = this.items.get(key);
    this.ctx.ui.setStatus(`mypi-${key}`, item && this.ctx.ui.theme.fg(item.color, item.text));
  }
}
