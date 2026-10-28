import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Box,
  type Component,
  Container,
  type SelectItem,
  SelectList,
  type SelectListTheme,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

/** Rows a list shows inside a dialog before it scrolls; the overlays (`/jobs`, `/agents`) share it. */
const DIALOG_LIST_ROWS = 12;

/** Theme shared by selectable rows in the dialog views. */
function selectListTheme(theme: Theme): SelectListTheme {
  return {
    selectedPrefix: (text) => theme.fg("accent", text),
    selectedText: (text) => theme.fg("accent", text),
    description: (text) => theme.fg("dim", text),
    scrollInfo: (text) => theme.fg("dim", text),
    noMatch: (text) => theme.fg("dim", text),
  };
}

/** Builds the shared list used inside centered dialogs. */
export function dialogList(
  rows: SelectItem[],
  theme: Theme,
  selectedValue: string | undefined,
  onSelect: (item: SelectItem) => void,
  onCancel: () => void,
): SelectList {
  const list = new SelectList(rows, DIALOG_LIST_ROWS, selectListTheme(theme));
  list.setSelectedIndex(
    Math.max(
      0,
      rows.findIndex((row) => row.value === selectedValue),
    ),
  );
  list.onSelect = onSelect;
  list.onCancel = onCancel;
  return list;
}

/** Dialog settings. */
type DialogOptions = {
  title: string;
};

/** A titled, bordered frame on a background. Children go inside the frame and receive every key. */
export class Dialog extends Container {
  private readonly content: Box;

  constructor(
    readonly theme: Theme,
    private readonly options: DialogOptions,
  ) {
    super();
    this.content = new Box(2, 1, (text) => theme.bg("customMessageBg", text));
    super.addChild(this.content);
  }

  render(width: number): string[] {
    const title = truncateToWidth(` ${this.options.title} `, width - 3, this.theme.fg("accent", "…"));
    const topFill = Math.max(0, width - visibleWidth(title) - 3);
    const bottomFill = Math.max(0, width - 2);

    const top = this.theme.fg("accent", `╭─${title}`) + this.theme.fg("accent", `${"─".repeat(topFill)}╮`);
    const bottom = this.theme.fg("accent", `╰${"─".repeat(bottomFill)}╯`);

    return [top, ...super.render(width), bottom];
  }

  /** Adds a child inside the frame, not beside it. */
  addChild(component: Component) {
    this.content.addChild(component);
  }

  invalidate(): void {
    super.invalidate();
    this.content.invalidate();
  }

  /** `Container` doesn't route input, so pass each key to every child. */
  handleInput(data: string) {
    for (const child of this.content.children) child.handleInput?.(data);
  }
}
