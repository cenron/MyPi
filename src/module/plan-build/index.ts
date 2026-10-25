import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentSettledEvent, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { FooterColor, type FooterItem } from "#ui/footer";
import { BaseModule } from "../base";
import { planCmd } from "./commands/plan";
import { offerPlan } from "./dialog";
import { PLANS_DIR } from "./plan-file";
import { BUILD_PROMPT, PLAN_PROMPT } from "./prompts";
import { planRule } from "./rule";
import { ASK_USER, askUserTool } from "./tools/ask-user";
import { SUBMIT_PLAN, submitPlanTool } from "./tools/submit-plan";
import { isMode, Mode, type PlanActions, type SubmittedPlan } from "./types";

/** Tools active only in Plan: entering Plan adds them, leaving removes them. */
const PLAN_TOOLS = [SUBMIT_PLAN, ASK_USER];

/** The footer label for each mode. */
const FOOTER_ITEMS: Record<Mode, FooterItem> = {
  [Mode.PLAN]: { text: "PLAN", color: FooterColor.WARNING },
  [Mode.BUILD]: { text: "BUILD", color: FooterColor.DIM },
};

/** The prompt section for each mode. */
const PROMPTS: Record<Mode, string> = {
  [Mode.PLAN]: PLAN_PROMPT,
  [Mode.BUILD]: BUILD_PROMPT,
};

export class PlanBuildModule extends BaseModule<{ mode: Mode }> {
  private readonly plansDir = join(this.session.project?.main ?? this.session.ctx.cwd, PLANS_DIR);
  private mode: Mode = Mode.PLAN;
  /** The plan `submit_plan` saved in this run, until the dialog takes it or the next run starts. In memory only. */
  private submittedPlan: SubmittedPlan | undefined;

  // Built once: `info` lists its command, and `info` is read on every footer, prompt, and state call.
  private readonly planCommand = planCmd(this.plansDir, {
    toggleMode: () => this.toggleMode(),
    setMode: (mode) => this.setMode(mode),
    saveBuildTo: (sessionManager) => this.saveStateTo(sessionManager, { mode: Mode.BUILD }),
  });

  get info(): ModuleInfo {
    return {
      name: "plan-build",
      description: "Plan changes in a restricted mode, then switch to Build to implement them.",
      commands: [this.planCommand.info],
      loadType: ModuleLoadMode.ALWAYS,
    };
  }

  init(): void {
    const savedMode = this.loadState()?.mode;
    this.mode = isMode(savedMode) ? savedMode : Mode.PLAN;
    this.setFooter(FOOTER_ITEMS[this.mode]);
    this.setPrompt(PROMPTS[this.mode]);
    // On resume and /reload pi restores the active tools from the transcript, so this only fixes up a new session.
    this.applyPlanTools();
    // submit_plan writes only its own file in .pi/plans/.
    this.setWritable({ dirs: [this.plansDir], tools: [SUBMIT_PLAN] });

    // before_agent_start fires once per run; agent_start fires again on each retry or continuation within it.
    this.session.pi.on("before_agent_start", () => this.onRunStart());
    this.session.pi.on("agent_settled", (ev, ctx) => this.onAgentSettled(ev, ctx));

    this.onKey("shift+tab", () => this.toggleMode());
    // Reads this.mode on every call, so a switch applies to the very next tool call, even mid-run.
    this.onToolCall((call, env) => (this.mode === Mode.PLAN ? planRule(call, env) : { kind: "allow" }));

    // Other modules, such as the done check, ask which mode is on.
    this.answer("mode", () => this.mode);
  }

  commands(): Command[] {
    return [this.planCommand];
  }

  /** `submit_plan` and `ask_user`, registered inactive; `applyPlanTools` turns them on in Plan only. */
  tools(): ToolDefinition[] {
    return [submitPlanTool(this.plansDir, (plan) => (this.submittedPlan = plan)), askUserTool()];
  }

  /** A new run starts with no plan: one submitted in an earlier run belongs to that run. */
  private onRunStart() {
    this.submittedPlan = undefined;
  }

  /**
   * Once a run that submitted a plan settles, asks what to do with it. pi awaits this, and defers a message sent
   * meanwhile until the settle is done, so Implement's message starts a new run instead of joining this one.
   */
  private async onAgentSettled(ev: AgentSettledEvent, ctx: ExtensionContext) {
    const plan = this.submittedPlan;
    if (ev.aborted || !plan || !ctx.hasUI || this.mode !== Mode.PLAN) return;

    this.submittedPlan = undefined;
    const actions: PlanActions = {
      switchToBuild: () => this.setMode(Mode.BUILD),
      sendUserMessage: (text) => this.session.pi.sendUserMessage(text),
      // Only commands can start sessions. A file URL preserves spaces through the command argument parser.
      implementInNewSession: (plan) =>
        this.session.pi.sendUserMessage(`/plan implement ${pathToFileURL(plan.path).href}`, {
          expandPromptTemplates: true,
        }),
    };
    await offerPlan(ctx, plan, actions);
  }

  private toggleMode() {
    this.setMode(this.mode === Mode.PLAN ? Mode.BUILD : Mode.PLAN);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;

    this.saveState({ mode: this.mode });
    this.setFooter(FOOTER_ITEMS[this.mode]);
    this.setPrompt(PROMPTS[this.mode]);
    this.applyPlanTools();
  }

  private applyPlanTools() {
    for (const tool of PLAN_TOOLS) this.setToolActive(tool, this.mode === Mode.PLAN);
  }
}
