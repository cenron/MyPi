import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, SettingsList } from "@earendil-works/pi-tui";

/** One row: `on` picks the starting circle. */
export type ToggleItem = {
  id: string;
  label: string;
  description?: string;
  on: boolean;
};

/** Callbacks for a `ToggleList`. Passing `onAccept` adds the Save row. */
export type ToggleListHandlers = {
  onToggle(id: string, on: boolean): void;
  onAccept?(): void;
  onCancel(): void;
};

/** Row id of the Save row; reserved so it can't collide with an item id. */
const APPLY_ID = "__apply__";

/**
 * An on/off list built on pi's `SettingsList`: a green `●` for on, a grey `○` for off. Space or Enter toggles a row,
 * Enter on Save accepts, Escape cancels. The Save row follows pi's theme picker: a row with a single value, so
 * activating it still fires `onChange`.
 */
export class ToggleList implements Component {
  private readonly list: SettingsList;

  constructor(theme: Theme, items: ToggleItem[], handlers: ToggleListHandlers, maxVisible = 15) {
    const on = theme.fg("success", "●");
    const off = theme.fg("dim", "○");

    const rows = items.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      currentValue: item.on ? on : off,
      values: [on, off],
    }));

    if (handlers.onAccept) {
      rows.push({
        id: APPLY_ID,
        label: "Save",
        description: "Save and close",
        currentValue: "save and close",
        values: ["save and close"],
      });
    }

    this.list = new SettingsList(
      rows,
      Math.min(rows.length + 2, maxVisible),
      getSettingsListTheme(),
      (id, value) => (id === APPLY_ID ? handlers.onAccept?.() : handlers.onToggle(id, value === on)),
      handlers.onCancel,
    );
  }

  render(width: number): string[] {
    return this.list.render(width);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }
}
