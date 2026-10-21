import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

import { Session } from "#core/session";
import { loadModules } from "#module/index";
import { registerCommand } from "./command";
import { initTools, registerTools, shutdownTools } from "./tool";
import type { Tool } from "./tool/types";

export class MyPi {
  private _session!: Session;
  /** The built-in tools `registerTools` returned, kept to run their `shutdown()` on `session_shutdown`. */
  private _tools: Tool[] = [];

  constructor(readonly pi: ExtensionAPI) {}

  onSessionStart(ev: SessionStartEvent, ctx: ExtensionContext) {
    this._session = new Session(ctx, this.pi);
    loadModules(this._session, ev.reason);
    // Tools before init(): a module's init() may turn its tools on, and pi ignores names it doesn't know yet.
    this._tools = registerTools(this.pi, this._session);
    initTools(this._tools);
    this._session.moduleManager.init();
    registerCommand(this.pi, this._session);
  }

  onBeforeAgentStart(ev: BeforeAgentStartEvent, _ctx: ExtensionContext) {
    this._session.promptManager.apply(ev.systemPromptOptions.sections);
  }

  async onToolCall(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    return this._session.toolGuard.check(ev, ctx);
  }

  onSessionEnd(_ev: SessionShutdownEvent, _ctx: ExtensionContext) {
    shutdownTools(this._tools, this._session);
  }
}
