import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Notification levels; the values match pi's `ctx.ui.notify` types. */
const MessageType = {
  Info: "info",
  Warning: "warning",
  Error: "error",
} as const;

type MessageType = (typeof MessageType)[keyof typeof MessageType];

/** Sends notifications through pi, and drops them when there is no UI (print and JSON modes). */
export class Notifier {
  constructor(readonly ctx: ExtensionContext) {}

  info(msg: string) {
    this.notify(msg, MessageType.Info);
  }

  warn(msg: string) {
    this.notify(msg, MessageType.Warning);
  }

  error(msg: string) {
    this.notify(msg, MessageType.Error);
  }

  private notify(msg: string, type: MessageType) {
    if (this.ctx.hasUI) this.ctx.ui.notify(msg, type);
  }
}
