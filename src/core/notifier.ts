import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const MessageType = {
  Info: "info",
  Warning: "warning",
  Error: "error",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

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
