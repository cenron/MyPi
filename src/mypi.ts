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
import { registerMcpServers } from "#mcp/index";
import { loadModules } from "#module/index";
import type { Tool } from "#tool/types";
import { registerCommand } from "./command";
import { initTools, registerTools, shutdownTools } from "./tool";

export class MyPi {
  private session!: Session;
  /** The built-in tools `registerTools` returned, kept to run their `shutdown()` on `session_shutdown`. */
  private tools: Tool[] = [];

  constructor(readonly pi: ExtensionAPI) {}

  onSessionStart(ev: SessionStartEvent, ctx: ExtensionContext) {
    this.session = new Session(ctx, this.pi);
    loadModules(this.session, ev.reason);
    // Tools before init(): a module's init() may turn its tools on, and pi ignores names it doesn't know yet.
    this.tools = registerTools(this.pi, this.session);
    initTools(this.tools);
    this.session.moduleManager.init();
    registerCommand(this.pi, this.session);
    registerMcpServers(this.pi, this.session);
  }

  onBeforeAgentStart(ev: BeforeAgentStartEvent, _ctx: ExtensionContext) {
    this.session.promptManager.apply(ev.systemPromptOptions.sections);
  }

  async onToolCall(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    return this.session.toolGuard.check(ev, ctx);
  }

  onSessionEnd(_ev: SessionShutdownEvent, _ctx: ExtensionContext) {
    shutdownTools(this.tools, this.session);
  }
}
