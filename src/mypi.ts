import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { Session } from "#core/session";
import { registerCommand } from "./command";

export class MyPi {
  constructor(readonly pi: ExtensionAPI) {}

  onSessionStart(_ev: SessionStartEvent, ctx: ExtensionContext) {
    const session = new Session(ctx);
    registerCommand(this.pi, session);
  }
}
