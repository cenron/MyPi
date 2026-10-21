import type { SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import type { Session } from "#core/session";
import type { ToolRule } from "#core/tool-guard";
import type { Command, Module, ModuleInfo } from "#core/types";
import type { KeyHandler } from "#ui/editor";
import type { FooterItem } from "#ui/footer";

/**
 * What every module extends: defaults for `init()`, `commands()`, and `tools()`, and the module's own saved state.
 * `State` is the module's state type; it's saved as `mypi-module-<info.name>`, so modules never collide with each other
 * or with core.
 */
export abstract class BaseModule<State = never> implements Module {
  constructor(readonly session: Session) {}

  abstract get info(): ModuleInfo;

  init(): void {}

  commands(): Command[] {
    return [];
  }

  /** None by default. Runs before `init()`, so a tool reads module state in `execute`, not when it's built. */
  tools(): ToolDefinition[] {
    return [];
  }

  /** Saves the module's state in the session; the last save on the branch wins. */
  protected saveState(state: State) {
    this.session.save(this.stateName, state);
  }

  /** Saves the module's state into another session, such as a new one in `ctx.newSession({ setup })`. */
  protected saveStateTo(sessionManager: SessionManager, state: State) {
    this.session.saveTo(sessionManager, this.stateName, state);
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

  protected onToolCall(rule: ToolRule) {
    this.session.toolGuard.set(this.info.name, rule);
  }

  protected setPrompt(prompt: string | undefined) {
    this.session.promptManager.set(this.info.name, prompt);
  }

  /**
   * Adds the tool to the active tools (the ones declared to the model) or removes it, leaving the rest alone. Pi
   * restores the active tools from the transcript, so a module adds and removes its own instead of saving a list. Does
   * nothing when the tool is already in that state.
   */
  protected setToolActive(name: string, active: boolean) {
    const tools = this.session.pi.getActiveTools();
    if (tools.includes(name) === active) return;
    this.session.pi.setActiveTools(active ? [...tools, name] : tools.filter((tool) => tool !== name));
  }

  private get stateName() {
    return `module-${this.info.name}`;
  }
}
