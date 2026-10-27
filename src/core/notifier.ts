import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Sends notifications through pi, and drops them when there is no UI (print and JSON modes). */
export class Notifier {
  constructor(readonly ctx: ExtensionContext) {}

  info(msg: string) {
    this.notify(msg, "info");
  }

  warn(msg: string) {
    this.notify(msg, "warning");
  }

  error(msg: string) {
    this.notify(msg, "error");
  }

  private notify(msg: string, type: "info" | "warning" | "error") {
    if (this.ctx.hasUI) this.ctx.ui.notify(msg, type);
  }
}
