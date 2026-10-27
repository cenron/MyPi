import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { identityPrompt, MYPI_ROOT } from "#core/identity";
import { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import { type Project, Worktrees } from "#core/worktree/index";
import { registerMcpServers } from "#mcp/index";
import { loadModules } from "#module/index";
import type { PromptPaths } from "#rule/base";
import { registerRules, updatePromptPaths } from "#rule/index";
import { backgroundRenderer } from "#tool/bash/render";
import type { Tool } from "#tool/types";
import { registerCommands } from "./command";
import { initTools, registerTools, shutdownTools } from "./tool";

export class MyPi {
  // Set on session_start, which pi always runs before any other handler here.
  private session!: Session;
  /** The built-in tools `registerTools` returned, kept to run their `shutdown()` on `session_shutdown`. */
  private tools: Tool[] = [];
  /** The prompt paths MyPi's own rules share, from `registerRules`; filled on the first run. */
  private prompt: PromptPaths = { paths: [] };

  constructor(readonly pi: ExtensionAPI) {
    // Once per extension load: pi keeps resolvers in a list, so registering on every session_start would stack them.
    pi.registerToolRenderer(backgroundRenderer);
  }

  async onSessionStart(ev: SessionStartEvent, ctx: ExtensionContext) {
    let project: Project | undefined;
    let discoveryError: string | undefined;
    try {
      project = await new Worktrees(ctx.cwd).project();
    } catch (error) {
      discoveryError = `Project discovery failed: ${errorMessage(error)}. Inspect the repository; starting without a project.`;
    }

    this.session = new Session(ctx, this.pi, project);
    this.session.markAsMyPi();
    this.prompt = registerRules(this.session.toolGuard);
    if (discoveryError) this.session.logWarning(discoveryError);

    loadModules(this.session, ev.reason);
    // Tools before init(): a module's init() may turn its tools on, and pi ignores names it doesn't know yet.
    this.tools = registerTools(this.pi, this.session);
    initTools(this.tools);
    this.session.moduleManager.init();
    registerCommands(this.pi, this.session);
    registerMcpServers(this.pi, this.session);
  }

  onBeforeAgentStart(ev: BeforeAgentStartEvent, ctx: ExtensionContext) {
    const running = this.session.moduleManager.moduleInfos.filter((info) => info.isLoaded).map((info) => info.name);
    this.session.promptManager.set("identity", identityPrompt(ctx.model, running, MYPI_ROOT));
    this.session.promptManager.apply(ev.systemPromptOptions.sections);
    updatePromptPaths(this.prompt, ev.systemPromptOptions);
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
