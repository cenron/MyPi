import type { ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "#ui/editor";
import { fakeUI } from "../fakes";

const SHIFT_TAB = "\x1b[Z";

type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent;

function fakeEditor() {
  const ui = fakeUI();
  const editor = new Editor({ ui } as unknown as ExtensionContext);
  /** Builds the editor pi would install, from the factory MyPi handed to `setEditorComponent`. */
  const installed = () => {
    const factory = ui.setEditorComponent.mock.calls[0]?.[0] as EditorFactory;
    const tui = { requestRender: () => {}, terminal: { rows: 24, columns: 80 } } as unknown as TUI;
    const theme = { borderColor: (s: string) => s, selectList: {} } as unknown as EditorTheme;
    const keybindings = { matches: () => false } as unknown as KeybindingsManager;
    return factory(tui, theme, keybindings);
  };
  return { editor, ui, installed };
}

describe("Editor", () => {
  it("leaves pi's editor alone until a key is registered", () => {
    const { ui } = fakeEditor();
    expect(ui.setEditorComponent).not.toHaveBeenCalled();
  });

  it("installs its editor once, on the first key", () => {
    const { editor, ui } = fakeEditor();
    editor.onKey("shift+tab", () => {});
    editor.onKey("ctrl+g", () => {});
    expect(ui.setEditorComponent).toHaveBeenCalledOnce();
  });

  it("runs the handler for a registered key, and pi never sees the key", async () => {
    const { editor, installed } = fakeEditor();
    const handler = vi.fn();
    editor.onKey("shift+tab", handler);
    const input = installed();

    input.handleInput?.(SHIFT_TAB);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(input.getText()).toBe("");
  });

  it("passes other keys to pi's editor", () => {
    const { editor, installed } = fakeEditor();
    editor.onKey("shift+tab", () => {});
    const input = installed();

    input.handleInput?.("a");
    expect(input.getText()).toBe("a");
  });

  // The installed editor reads the live map, so modules started later still get their keys.
  it("runs keys registered after it's installed", async () => {
    const { editor, installed } = fakeEditor();
    editor.onKey("ctrl+g", () => {});
    const input = installed();
    const handler = vi.fn();
    editor.onKey("shift+tab", handler);

    input.handleInput?.(SHIFT_TAB);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  });

  it("uses the latest handler for a key", async () => {
    const { editor, installed } = fakeEditor();
    const first = vi.fn();
    const second = vi.fn();
    editor.onKey("shift+tab", first);
    editor.onKey("shift+tab", second);

    installed().handleInput?.(SHIFT_TAB);
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
  });

  it.each([
    [
      "throws",
      () => {
        throw new Error("boom");
      },
    ],
    [
      "rejects",
      async () => {
        throw new Error("boom");
      },
    ],
  ])("shows an error when the handler %s, instead of breaking input", async (_, handler) => {
    const { editor, ui, installed } = fakeEditor();
    editor.onKey("shift+tab", handler);
    const input = installed();

    input.handleInput?.(SHIFT_TAB);
    await vi.waitFor(() => expect(ui.notify).toHaveBeenCalledWith("boom", "error"));
    input.handleInput?.("a");
    expect(input.getText()).toBe("a");
  });
});
