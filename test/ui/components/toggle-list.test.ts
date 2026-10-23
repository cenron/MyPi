import { stripVTControlCharacters } from "node:util";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type ToggleItem, ToggleList } from "#ui/components/toggle-list";

const SPACE = " ";
const ENTER = "\r";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

// Plain-text colors, so the circles compare as "●" and "○".
const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

const items: ToggleItem[] = [
  { id: "a", label: "a", description: "first", on: true },
  { id: "b", label: "b", description: "second", on: false },
];

function fakeHandlers() {
  return { onToggle: vi.fn(), onAccept: vi.fn(), onCancel: vi.fn() };
}

function renderText(list: ToggleList): string[] {
  return list.render(60).map((line) => stripVTControlCharacters(line));
}

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("ToggleList", () => {
  it("toggles the selected row with Space and Enter", () => {
    const handlers = fakeHandlers();
    const list = new ToggleList(theme, items, handlers);

    list.handleInput(SPACE);
    list.handleInput(DOWN);
    list.handleInput(ENTER);

    expect(handlers.onToggle.mock.calls).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(renderText(list)[0]).toMatch(/a\s+○/);
  });

  it("adds a Save row that calls onAccept", () => {
    const handlers = fakeHandlers();
    const list = new ToggleList(theme, items, handlers);
    expect(renderText(list)[2]).toContain("Save");

    list.handleInput(UP);
    list.handleInput(ENTER);

    expect(handlers.onAccept).toHaveBeenCalledOnce();
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });

  it("leaves out the Save row without onAccept", () => {
    const { onToggle, onCancel } = fakeHandlers();
    const list = new ToggleList(theme, items, { onToggle, onCancel });
    expect(renderText(list).join("\n")).not.toContain("Save");

    list.handleInput(UP);
    list.handleInput(SPACE);

    expect(onToggle).toHaveBeenCalledWith("b", true);
  });

  describe("a disabled row", () => {
    const locked: ToggleItem[] = [
      { id: "a", label: "a", on: true, disabled: true },
      { id: "b", label: "a much longer label", on: false },
    ];

    it("ignores Space and Enter", () => {
      const handlers = fakeHandlers();
      const list = new ToggleList(theme, locked, handlers);

      list.handleInput(SPACE);
      list.handleInput(ENTER);

      expect(handlers.onToggle).not.toHaveBeenCalled();
      expect(renderText(list)[0]).toMatch(/a \(locked\)\s+●/);
    });

    // SettingsList pads every label to the longest before styling it, so the disabled one must still match.
    it("stays dim next to a longer label", () => {
      const tagDim = { fg: (color: string, text: string) => (color === "dim" ? `<dim>${text}</dim>` : text) };
      const lines = renderText(new ToggleList(tagDim as unknown as Theme, locked, fakeHandlers()));
      expect(lines[0]).toMatch(/<dim>a \(locked\)\s*<\/dim>/);
    });
  });
});
