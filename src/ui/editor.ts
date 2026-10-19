import { CustomEditor, type ExtensionContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, type KeyId, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { errorMessage } from "#core/util/errors";

/** Runs when its key is pressed in the editor. */
export type KeyHandler = () => Promise<void> | void;

/**
 * MyPi's editor. Modules register keys with `onKey`; the first one installs `MyPiEditor` in pi's single editor slot,
 * so pi keeps its own editor until a module needs a key. Pi removes the editor on `/reload` and on each session
 * switch, and the next session's modules register their keys again.
 */
export class Editor {
  private readonly handlers = new Map<KeyId, KeyHandler>();
  private installed = false;

  constructor(readonly ctx: ExtensionContext) {}

  /** Runs `handler` when `key` is pressed, before pi sees the key. A later handler for the same key replaces it. */
  onKey(key: KeyId, handler: KeyHandler) {
    this.handlers.set(key, handler);
    if (!this.installed) this.install();
  }

  private install() {
    this.installed = true;
    this.ctx.ui.setEditorComponent(
      (tui, theme, keybindings) => new MyPiEditor(tui, theme, keybindings, this.handlers, this.reportError),
    );
  }

  private reportError = (error: unknown) => this.ctx.ui.notify(errorMessage(error), "error");
}

/**
 * Pi's editor plus MyPi's keys. It checks them before `super.handleInput`, so they win over pi's own bindings, even
 * reserved ones like Shift+Tab. Pi copies its editor's text, autocomplete and actions onto it when it's installed.
 */
class MyPiEditor extends CustomEditor {
  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    // The editor's own map, not a copy, so keys registered after it's installed still work.
    private readonly handlers: ReadonlyMap<KeyId, KeyHandler>,
    private readonly onError: (error: unknown) => void,
  ) {
    // Pi's default editor draws the working spinner in its border. It's set only here; padding is copied in later.
    super(tui, theme, keybindings, { embedWorkingStatus: true });
  }

  handleInput(data: string): void {
    for (const [key, handler] of this.handlers) {
      if (matchesKey(data, key)) {
        // Like pi's extension shortcuts: run async, and report errors instead of breaking input.
        Promise.resolve().then(handler).catch(this.onError);
        return;
      }
    }
    super.handleInput(data);
  }
}
