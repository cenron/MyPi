import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Notifier } from "./notifier.ts";

export class Session {
  private notifier: Notifier;

  constructor(readonly ctx: ExtensionContext) {
    this.notifier = new Notifier(this.ctx);
  }

  log(msg: string) {
    this.notifier.info(msg);
  }

  log_warning(msg: string) {
    this.notifier.warn(msg);
  }

  log_error(msg: string) {
    this.notifier.error(msg);
  }
}
