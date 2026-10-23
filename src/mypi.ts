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
import { backgroundRenderer } from "#tool/bash/render";
import type { Tool } from "#tool/types";
import { registerCommands } from "./command";
import { initTools, registerTools, shutdownTools } from "./tool";

export class MyPi {
  // Set on session_start, which pi always runs before any other handler here.
  private session!: Session;
  /** The built-in tools `registerTools` returned, kept to run their `shutdown()` on `session_shutdown`. */
  private tools: Tool[] = [];

  constructor(readonly pi: ExtensionAPI) {
    // Once per extension load: pi keeps resolvers in a list, so registering on every session_start would stack them.
    pi.registerToolRenderer(backgroundRenderer);
  }

  onSessionStart(ev: SessionStartEvent, ctx: ExtensionContext) {
    this.session = new Session(ctx, this.pi);
    loadModules(this.session, ev.reason);
    // Tools before init(): a module's init() may turn its tools on, and pi ignores names it doesn't know yet.
    this.tools = registerTools(this.pi, this.session);
    initTools(this.tools);
    this.session.moduleManager.init();
    registerCommands(this.pi, this.session);
    registerMcpServers(this.pi, this.session);
  }

  onBeforeAgentStart(ev: BeforeAgentStartEvent, _ctx: ExtensionContext) {
    this.session.promptManager.apply(ev.systemPromptOptions.sections);
  }

  async onToolCall(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    return this.session.toolGuard.check(ev, ctx);
  }

  onSessionEnd(_ev: SessionShutdownEvent, _ctx: ExtensionContext) {
    // Jobs first: nothing a job runs should outlive the session, whatever a tool's shutdown does.
    this.session.jobs.stopAll();
    shutdownTools(this.tools, this.session);
  }
}
