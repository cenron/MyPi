import type { KeyId } from "@earendil-works/pi-tui";
import type { Session } from "#core/session";
import type { Command, Module, ModuleInfo } from "#core/types";
import type { KeyHandler } from "#ui/editor";
import type { FooterItem } from "#ui/footer";

/**
 * What every module extends: defaults for `init()` and `commands()`, and the module's own saved state. `State` is the
 * module's state type; it's saved as `mypi-module-<info.name>`, so modules never collide with each other or with core.
 */
export abstract class BaseModule<State = never> implements Module {
  constructor(readonly session: Session) {}

  abstract get info(): ModuleInfo;

  init(): void {}

  commands(): Command[] {
    return [];
  }

  /** Saves the module's state in the session; the last save on the branch wins. */
  protected saveState(state: State) {
    this.session.save(this.stateName, state);
  }

  /** The module's last saved state, or undefined. It trusts the session file, so check any field you rely on. */
  protected loadState(): State | undefined {
    return this.session.load(this.stateName) as State | undefined;
  }

  protected setFooter(item: FooterItem | undefined) {
    this.session.footer.set(this.info.name, item);
  }

  protected onKey(key: KeyId, handler: KeyHandler) {
    this.session.editor.onKey(key, handler);
  }

  protected setPrompt(prompt: string | undefined) {
    this.session.promptManager.set(this.info.name, prompt);
  }

  private get stateName() {
    return `module-${this.info.name}`;
  }
}
