import type {
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { Session } from "#core/session";
import { loadModules } from "#module/index";
import { registerCommand } from "./command";

export class MyPi {
  constructor(readonly pi: ExtensionAPI) {}

  onSessionStart(_ev: SessionStartEvent, ctx: ExtensionContext) {
    const session = new Session(ctx, this.pi);
    const modules = loadModules(session);
    registerCommand(this.pi, session, modules);
  }

  onSessionEnd(_ev: SessionShutdownEvent, _ctx: ExtensionContext) {}
}
