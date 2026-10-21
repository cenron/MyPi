import { relative } from "node:path";
import type { AgentSettledEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { FooterColor, type FooterItem } from "#ui/footer";
import { BaseModule } from "../base";
import { offerPlan, PLAN_CHOICES, type PlanActions } from "./dialog";
import { findPlan, implementInNewSession } from "./implement";
import type { SubmittedPlan } from "./plan-file";
import { BUILD_PROMPT, PLAN_PROMPT } from "./prompts";
import { planRule } from "./rule";
import { ASK_USER, askUserTool } from "./tools/ask-user";
import { SUBMIT_PLAN, submitPlanTool } from "./tools/submit-plan";

const Mode = {
  PLAN: "plan",
  BUILD: "build",
} as const;

type Mode = (typeof Mode)[keyof typeof Mode];
const isMode = (value: unknown): value is Mode => (Object.values(Mode) as unknown[]).includes(value);

/** Tools active only in Plan: entering Plan adds them, leaving removes them. */
const PLAN_TOOLS = [SUBMIT_PLAN, ASK_USER];

export class PlanBuildModule extends BaseModule<{ mode: Mode }> {
  private mode: Mode = Mode.PLAN;
  private _submittedPlan: SubmittedPlan | undefined;

  private footerItems: Record<Mode, FooterItem> = {
    [Mode.PLAN]: { text: "PLAN", color: FooterColor.Warning },
    [Mode.BUILD]: { text: "BUILD", color: FooterColor.Dim },
  };

  private prompts: Record<Mode, string> = {
    [Mode.PLAN]: PLAN_PROMPT,
    [Mode.BUILD]: BUILD_PROMPT,
  };

  get info(): ModuleInfo {
    return {
      name: "plan-build",
      description: "Plan changes in a restricted mode, then switch to Build to implement them.",
      commands: this.commands().flatMap((command) => command.info),
      loadType: ModuleLoadMode.ALWAYS,
    };
  }

  init(): void {
    const savedMode = this.loadState()?.mode;
    this.mode = isMode(savedMode) ? savedMode : Mode.PLAN;
    this.setFooter(this.footerItems[this.mode]);
    this.setPrompt(this.prompts[this.mode]);
    this.registerTool(submitPlanTool((plan) => (this._submittedPlan = plan)));
    this.registerTool(askUserTool());
    this.initEventHandlers();

    // On resume and /reload pi restores the active tools from the transcript, so this only fixes up a new session.
    this.applyPlanTools();
    this.onKey("shift+tab", () => this.toggleMode());
    // Reads this.mode on every call, so a switch applies to the very next tool call, even mid-run.
    this.onToolCall((call, env) => (this.mode === Mode.PLAN ? planRule(call, env) : { kind: "allow" }));
  }

  /** The plan `submit_plan` saved in this run, until the dialog takes it or the next run starts. In memory only. */
  get submittedPlan(): SubmittedPlan | undefined {
    return this._submittedPlan;
  }

  commands(): Command[] {
    return [
      {
        info: {
          name: "plan",
          description: "Toggle Plan/Build mode (plan|build: pick one; implement [plan file]: in a new session)",
        },
        execute: async (ctx, args) => {
          const [arg, file] = args;

          switch (arg) {
            case "implement": {
              const path = await findPlan(ctx.cwd, file);
              return implementInNewSession(ctx, path, (sessionManager) =>
                this.saveStateTo(sessionManager, { mode: Mode.BUILD }),
              );
            }

            case undefined:
              this.toggleMode();
              break;

            default:
              if (!isMode(arg)) throw new Error(`Unknown mode: ${arg} (use plan, build, or implement)`);
              this.setMode(arg);
          }
        },
      },
    ];
  }

  private initEventHandlers() {
    // before_agent_start fires once per run; agent_start fires again on each retry or continuation within it.
    this.session.pi.on("before_agent_start", () => {
      this._submittedPlan = undefined;
    });
    this.session.pi.on("agent_settled", (ev, ctx) => this.onAgentSettled(ev, ctx));
  }

  /**
   * Once a run that submitted a plan settles, asks what to do with it. pi awaits this, and defers a message sent
   * meanwhile until the settle is done, so Implement's message starts a new run instead of joining this one.
   */
  private async onAgentSettled(ev: AgentSettledEvent, ctx: ExtensionContext) {
    const plan = this._submittedPlan;
    if (ev.aborted || !plan || !ctx.hasUI || this.mode !== Mode.PLAN) return;

    this._submittedPlan = undefined;
    const actions: PlanActions = {
      switchToBuild: () => this.setMode(Mode.BUILD),
      sendUserMessage: (text) => this.session.pi.sendUserMessage(text),
      // Only a command's context can start a session, so go through /plan implement. The path is relative to the
      // cwd, which may hold spaces; the plan's own name never does.
      implementInNewSession: (plan) =>
        this.session.pi.sendUserMessage(`/plan implement ${relative(ctx.cwd, plan.path)}`, {
          expandPromptTemplates: true,
        }),
    };
    await offerPlan(ctx, plan, PLAN_CHOICES, actions);
  }

  private toggleMode() {
    this.setMode(this.mode === Mode.PLAN ? Mode.BUILD : Mode.PLAN);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;

    this.saveState({ mode: this.mode });
    this.setFooter(this.footerItems[this.mode]);
    this.setPrompt(this.prompts[this.mode]);
    this.applyPlanTools();
  }

  private applyPlanTools() {
    for (const tool of PLAN_TOOLS) this.setToolActive(tool, this.mode === Mode.PLAN);
  }
}
