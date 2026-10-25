import type { SessionManager, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";
import type { MyPiNotices, MyPiQuestions } from "#core/channels";
import * as bus from "#core/events";
import type { Session } from "#core/session";
import type { ToolRule, Writable } from "#core/tool-guard";
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

  /** Does nothing by default. Runs once per session, after every tool is registered. */
  init(): void {}

  /** None by default. */
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

  /** Sets this module's footer item, or clears it with `undefined`. */
  protected setFooter(item: FooterItem | undefined) {
    this.session.footer.set(this.info.name, item);
  }

  /** Runs `handler` when `key` is pressed in the editor, before pi sees it. */
  protected onKey(key: KeyId, handler: KeyHandler) {
    this.session.editor.onKey(key, handler);
  }

  /** Sets this module's rule on every tool call; a block from any module wins. */
  protected onToolCall(rule: ToolRule) {
    this.session.toolGuard.set(this.info.name, rule);
  }

  /** What a read-only mode (Plan) still lets this module write. Rules read it on each call, so init order is free. */
  protected setWritable(writable: Writable) {
    this.session.toolGuard.setWritable(this.info.name, writable);
  }

  /** Sets this module's system prompt section, or removes it with `undefined`; the next run sends it. */
  protected setPrompt(prompt: string | undefined) {
    this.session.promptManager.set(this.info.name, prompt);
  }

  /** Tells every listener on `channel` (`MyPiNotices`). */
  protected publish<K extends keyof MyPiNotices>(channel: K, notice: MyPiNotices[K]) {
    bus.publish(this.session.pi.events, channel, notice);
  }

  /** Calls `handler` with each notice on `channel` (`MyPiNotices`) until `/reload`. */
  protected subscribe<K extends keyof MyPiNotices>(channel: K, handler: (notice: MyPiNotices[K]) => void) {
    bus.subscribe(this.session.pi.events, channel, handler);
  }

  /** Asks every module that answers on `channel` (`MyPiQuestions`); empty when none does. */
  protected ask<K extends keyof MyPiQuestions>(channel: K, request: MyPiQuestions[K]["request"]) {
    return bus.ask(this.session.pi.events, channel, request);
  }

  /** Answers every question on `channel` (`MyPiQuestions`) as this module, until `/reload`. */
  protected answer<K extends keyof MyPiQuestions>(
    channel: K,
    handler: (request: MyPiQuestions[K]["request"]) => Promise<MyPiQuestions[K]["answer"]> | MyPiQuestions[K]["answer"],
  ) {
    bus.answer(this.session.pi.events, channel, this.info.name, handler);
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
