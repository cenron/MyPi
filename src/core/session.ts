import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Editor } from "#ui/editor";
import { Footer } from "#ui/footer";
import { ModuleManager } from "./module-manager";
import { Notifier } from "./notifier";

/** Per-session handle passed to commands and modules: pi's context and API, logging, saved state, and the modules. */
export class Session {
  private readonly _notifier: Notifier;
  private readonly _moduleManager: ModuleManager;
  private readonly _footer: Footer;
  private readonly _editor: Editor;

  constructor(
    readonly ctx: ExtensionContext,
    readonly pi: ExtensionAPI,
  ) {
    this._notifier = new Notifier(this.ctx);
    this._moduleManager = new ModuleManager(this);
    this._footer = new Footer(this.ctx);
    this._editor = new Editor(this.ctx);
  }

  /** Saves `data` in the session as a `mypi-<name>` entry; not sent to the model. Modules use `BaseModule.saveState`. */
  save(name: string, data: unknown) {
    this.pi.appendEntry(`mypi-${name}`, data);
  }

  /** The last `mypi-<name>` entry's data on the current branch, or undefined. The file can hold anything. */
  load(name: string): unknown {
    let data: unknown;
    for (const entry of this.ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === `mypi-${name}`) data = entry.data;
    }
    return data;
  }

  log(msg: string) {
    this._notifier.info(msg);
  }

  logWarning(msg: string) {
    this._notifier.warn(msg);
  }

  logError(msg: string) {
    this._notifier.error(msg);
  }

  get moduleManager(): ModuleManager {
    return this._moduleManager;
  }

  get footer(): Footer {
    return this._footer;
  }

  get editor(): Editor {
    return this._editor;
  }
}
