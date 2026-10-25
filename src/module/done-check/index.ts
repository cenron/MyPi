import type {
  AgentBeforeSettleEvent,
  AgentBeforeSettleEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { fileChanges, fileTimes } from "#core/util/walk";
import { FooterColor } from "#ui/footer";
import { BaseModule } from "../base";
import { errorsReport, filesToCheck } from "./report";

/** Most times one run is sent back; after that the agent may stop with whatever is left. */
const MAX_ROUNDS = 3;

/** The report's entry type in the session. */
const REPORT_TYPE = "mypi-done-check";

/** A Build run's file times at its start, how many times it was sent back, and the last report it got. */
type Run = { before: Map<string, number>; rounds: number; lastReport?: string };

/**
 * When the agent is about to stop in Build, checks the files the run changed and, when they have errors, sends it
 * back to fix them or say why they're fine. The errors come from whoever answers `diagnostics` on the bus (the LSP
 * module); the mode from whoever answers `mode` (plan-build).
 */
export class DoneCheckModule extends BaseModule {
  /** The current run; undefined before the first. */
  private run: Run | undefined;

  get info(): ModuleInfo {
    return {
      name: "done-check",
      description: "When the agent is about to stop in Build, checks the files it changed and sends it back on errors.",
      commands: [],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    // before_agent_start fires once per run; the check's own continuation stays in the same run, keeping its count.
    this.session.pi.on("before_agent_start", (_ev, ctx) => this.onRunStart(ctx));
    this.session.pi.on("agent_before_settle", (ev, ctx) => this.onBeforeSettle(ev, ctx));
  }

  /** Records the files' times when a run starts, to find what it changed. */
  private async onRunStart(ctx: ExtensionContext) {
    this.run = { before: await fileTimes(ctx.cwd), rounds: 0 };
  }

  /**
   * The check, as pi's last chance to continue the run. Sends the report back and asks for one more model request,
   * unless the run didn't finish normally, nothing changed, there are no errors, the last round got the same report,
   * or the rounds are used up: pi's docs warn that an unconditional continuation loops.
   */
  private async onBeforeSettle(
    ev: AgentBeforeSettleEvent,
    ctx: ExtensionContext,
  ): Promise<AgentBeforeSettleEventResult | undefined> {
    const run = this.run;
    if (!run || ev.outcome !== "completed" || run.rounds >= MAX_ROUNDS) return undefined;
    if (!(await this.inBuild())) return undefined;

    const { files, skipped } = filesToCheck(fileChanges(run.before, await fileTimes(ctx.cwd)));
    if (files.length === 0) return undefined;

    const report = await this.check(files, skipped, ctx);
    if (report === undefined || report === run.lastReport) return undefined;

    run.rounds++;
    run.lastReport = report;
    return {
      entries: [{ type: "custom_message", customType: REPORT_TYPE, content: report, display: true }],
      continue: true,
    };
  }

  /** The report for `files`, or undefined when they have no errors. A source that fails is told to the user. */
  private async check(files: string[], skipped: number, ctx: ExtensionContext): Promise<string | undefined> {
    this.setFooter({ text: "checking…", color: FooterColor.MUTED });
    try {
      const answers = await this.ask("diagnostics", { files, signal: ctx.signal });
      for (const answer of answers) {
        if (answer.kind === "failed")
          this.session.logWarning(`Done check: ${answer.from} couldn't check: ${answer.error}`);
      }

      const problems = answers.flatMap((answer) => (answer.kind === "answer" ? answer.value : []));
      return errorsReport(problems, ctx.cwd, skipped);
    } finally {
      this.setFooter(undefined);
    }
  }

  /** True unless a module answers `mode` with Plan; with no plan-build, every run counts as Build. */
  private async inBuild(): Promise<boolean> {
    const answers = await this.ask("mode", undefined);
    return !answers.some((answer) => answer.kind === "answer" && answer.value === "plan");
  }
}
