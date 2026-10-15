import { stripVTControlCharacters } from "node:util";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "#ui/components/dialog";

// Plain-text colours, so line widths are just character counts.
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
} as unknown as Theme;

function fakeChild(lines: string[] = []) {
  return { render: () => lines, invalidate: vi.fn(), handleInput: vi.fn() };
}

describe("Dialog", () => {
  it("draws the top and bottom borders at exactly the given width", () => {
    for (const width of [20, 40, 100]) {
      const lines = new Dialog(theme, { title: "Modules" }).render(width);
      expect(visibleWidth(lines[0] ?? "")).toBe(width);
      expect(visibleWidth(lines.at(-1) ?? "")).toBe(width);
    }
  });

  it("truncates a title that doesn't fit, so the top border keeps its width", () => {
    const [top] = new Dialog(theme, { title: "Modules" }).render(10);
    // truncateToWidth adds ANSI resets around the ellipsis, even with plain colours.
    expect(stripVTControlCharacters(top ?? "")).toBe("╭─ Modul…╮");
    expect(visibleWidth(top ?? "")).toBe(10);
  });

  it("keeps the accent colour on the whole top border when the title is cut", () => {
    const accent = {
      fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
      bg: (_color: string, text: string) => text,
    } as unknown as Theme;
    const [top = ""] = new Dialog(accent, { title: "Modules" }).render(10);

    // After the last reset, the accent colour has to be switched back on before the corner.
    const afterReset = top.slice(top.lastIndexOf("\x1b[0m"));
    expect(afterReset).toContain("\x1b[36m╮");
    expect(top).toContain("\x1b[36m…");
  });

  it("puts the title in the top border", () => {
    const [top] = new Dialog(theme, { title: "Modules" }).render(40);
    expect(top).toMatch(/^╭─ Modules ─+╮$/);
  });

  it("renders its children between the borders", () => {
    const dialog = new Dialog(theme, { title: "Modules" });
    dialog.addChild(fakeChild(["hello"]));

    const lines = dialog.render(40);

    const body = lines.slice(1, -1).join("\n");
    expect(body).toContain("hello");
  });

  it("passes every key on to its children", () => {
    const dialog = new Dialog(theme, { title: "Modules" });
    const first = fakeChild();
    const second = fakeChild();
    dialog.addChild(first);
    dialog.addChild(second);
    dialog.addChild({ render: () => [], invalidate: () => {} });

    dialog.handleInput("x");

    expect(first.handleInput).toHaveBeenCalledWith("x");
    expect(second.handleInput).toHaveBeenCalledWith("x");
  });

  it("invalidates its children", () => {
    const dialog = new Dialog(theme, { title: "Modules" });
    const child = fakeChild();
    dialog.addChild(child);

    dialog.invalidate();

    expect(child.invalidate).toHaveBeenCalled();
  });
});
