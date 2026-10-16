import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ModuleManager } from "#core/module-manager";
import { Notifier } from "./notifier";

/** Per-session handle passed to commands and modules: pi's context and API, logging, and the module list. */
export class Session {
  private readonly _notifier: Notifier;
  private readonly _moduleManager: ModuleManager;

  constructor(
    readonly ctx: ExtensionContext,
    readonly pi: ExtensionAPI,
  ) {
    this._notifier = new Notifier(this.ctx);
    this._moduleManager = new ModuleManager();
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
}
