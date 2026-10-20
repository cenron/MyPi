import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { Session } from "#core/session";
import { loadModules } from "#module/index";
import { registerCommand } from "./command";

export class MyPi {
  private _session!: Session;

  constructor(readonly pi: ExtensionAPI) {}

  onSessionStart(ev: SessionStartEvent, ctx: ExtensionContext) {
    this._session = new Session(ctx, this.pi);
    loadModules(this._session, ev.reason);
    registerCommand(this.pi, this._session);
  }

  onBeforeAgentStart(ev: BeforeAgentStartEvent, _ctx: ExtensionContext) {
    this._session.promptManager.apply(ev.systemPromptOptions.sections);
  }

  onSessionEnd(_ev: SessionShutdownEvent, _ctx: ExtensionContext) {}
}
