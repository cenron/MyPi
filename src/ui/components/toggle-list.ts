import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, SettingsList } from "@earendil-works/pi-tui";

/** One row: `on` picks the starting circle. */
export type ToggleItem = {
  id: string;
  label: string;
  description?: string;
  on: boolean;
  disabled?: boolean;
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

    const disabledItems = items.filter((item) => item.disabled);
    const disabledIds = new Set(disabledItems.map((item) => item.id));
    // SettingsList's theme sees only the label text, so a disabled row is found by its label; keep labels unique.
    const disabledLabels = new Set(disabledItems.map((item) => item.label));

    // Set our theme for the label, so it can show disabled items in dim text
    const settingsTheme = getSettingsListTheme();
    const listTheme = {
      ...settingsTheme,
      label: (text: string, selected: boolean) =>
        disabledLabels.has(text.trimEnd()) ? theme.fg("dim", text) : settingsTheme.label(text, selected),
    };

    const rows = items.map((item) => {
      const currentValue = item.on ? on : off;
      return {
        id: item.id,
        label: item.label,
        description: item.description,
        currentValue,
        values: item.disabled ? [currentValue] : [on, off],
      };
    });

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
      listTheme,
      (id, value) => {
        if (id === APPLY_ID) handlers.onAccept?.();
        else if (!disabledIds.has(id)) handlers.onToggle(id, value === on);
      },
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
