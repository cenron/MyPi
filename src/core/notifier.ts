import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Notification levels; the values match pi's `ctx.ui.notify` types. */
const MessageType = {
  INFO: "info",
  WARNING: "warning",
  ERROR: "error",
} as const;

type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Sends notifications through pi, and drops them when there is no UI (print and JSON modes). */
export class Notifier {
  constructor(readonly ctx: ExtensionContext) {}

  info(msg: string) {
    this.notify(msg, MessageType.INFO);
  }

  warn(msg: string) {
    this.notify(msg, MessageType.WARNING);
  }

  error(msg: string) {
    this.notify(msg, MessageType.ERROR);
  }

  private notify(msg: string, type: MessageType) {
    if (this.ctx.hasUI) this.ctx.ui.notify(msg, type);
  }
}
