import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ModuleInfo } from "#core/types";
import { Notifier } from "./notifier";

/** Per-session handle passed to commands and modules: pi's context and API, logging, and the module list. */
export class Session {
  private modulesList: ModuleInfo[];
  private notifier: Notifier;

  constructor(
    readonly ctx: ExtensionContext,
    readonly pi: ExtensionAPI,
  ) {
    this.notifier = new Notifier(this.ctx);
    this.modulesList = [];
  }

  log(msg: string) {
    this.notifier.info(msg);
  }

  logWarning(msg: string) {
    this.notifier.warn(msg);
  }

  logError(msg: string) {
    this.notifier.error(msg);
  }

  get modules(): ModuleInfo[] {
    return this.modulesList;
  }

  set modules(modules: ModuleInfo[]) {
    this.modulesList = [...modules];
  }
}
