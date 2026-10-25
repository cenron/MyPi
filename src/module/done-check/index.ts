import type {
  AgentBeforeSettleEvent,
  AgentBeforeSettleEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { fileChanges, fileTimes } from "#core/util/walk";
import { FooterColor } from "#ui/footer";
import { BaseModule } from "../base";
import { doneCheckCmd } from "./commands/done-check";
import {
  approvalKey,
  approve,
  COMMANDS_FILE,
  type CommandFailure,
  isApproved,
  readCommands,
  runCommand,
} from "./project-commands";
import { doneCheckReport, filesToCheck } from "./report";

/** Most times one run is sent back; after that the agent may stop with whatever is left. */
const MAX_ROUNDS = 3;

/** The report's entry type in the session. */
const REPORT_TYPE = "mypi-done-check";

const YES = "Yes";

/** A Build run's file times at its start, how many times it was sent back, and the last report it got. */
type Run = { before: Map<string, number>; rounds: number; lastReport?: string };

/**
 * When the agent is about to stop in Build, checks what the run changed and, when something is broken, sends it back
 * to fix it or say why it's fine: the errors in the changed files, from whoever answers `diagnostics` on the bus (the
 * LSP module), and the project's own check commands from `.pi/done-check.json`, once the user approved them. The mode
 * comes from whoever answers `mode` (plan-build).
 */
export class DoneCheckModule extends BaseModule {
  /** The current run; undefined before the first. */
  private run: Run | undefined;
  /** Command lists the user said No to this session, so they're not asked again until the next one. */
  private readonly declined = new Set<string>();
  /** Warnings already shown this session, each shown once. */
  private readonly warned = new Set<string>();
  // Built once: `info` lists its info.
  private readonly doneCheckCommand = doneCheckCmd(this.session);

  get info(): ModuleInfo {
    return {
      name: "done-check",
      description:
        "When the agent is about to stop in Build, checks what it changed and sends it back when it's broken.",
      commands: [this.doneCheckCommand.info],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    // before_agent_start fires once per run; the check's own continuation stays in the same run, keeping its count.
    this.session.pi.on("before_agent_start", (_ev, ctx) => this.onRunStart(ctx));
    this.session.pi.on("agent_before_settle", (ev, ctx) => this.onBeforeSettle(ev, ctx));
  }

  commands(): Command[] {
    return [this.doneCheckCommand];
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

  /** The report for `files` and the project's commands, or undefined when nothing is broken. */
  private async check(files: string[], skipped: number, ctx: ExtensionContext): Promise<string | undefined> {
    this.setFooter({ text: "checking…", color: FooterColor.MUTED });
    try {
      const problems = await this.problemsIn(files, ctx);
      const failures = await this.runCommands(ctx);
      return doneCheckReport({ problems, failures, skipped }, ctx.cwd);
    } finally {
      this.setFooter(undefined);
    }
  }

  /** Every source's problems in `files`. A source that fails is told to the user, who can fix it; the agent can't. */
  private async problemsIn(files: string[], ctx: ExtensionContext) {
    const answers = await this.ask("diagnostics", { files, signal: ctx.signal });
    for (const answer of answers) {
      if (answer.kind === "failed")
        this.session.logWarning(`Done check: ${answer.from} couldn't check: ${answer.error}`);
    }
    return answers.flatMap((answer) => (answer.kind === "answer" ? answer.value : []));
  }

  /** Runs the project's approved commands one after another, in its folder; the ones that failed. */
  private async runCommands(ctx: ExtensionContext): Promise<CommandFailure[]> {
    const failures: CommandFailure[] = [];
    for (const command of await this.approvedCommands(ctx)) {
      const failure = await runCommand(command, ctx.cwd, ctx.signal);
      if (failure) failures.push(failure);
    }
    return failures;
  }

  /**
   * The project's commands, once the user approved exactly this list on this machine: asked the first time it's seen
   * and whenever it changes. A No holds for the session; without a UI, nothing runs and the user is told once. A file
   * that isn't a list of commands is told once too.
   */
  private async approvedCommands(ctx: ExtensionContext): Promise<string[]> {
    let commands: string[] | undefined;
    try {
      commands = await readCommands(ctx.cwd);
    } catch (error) {
      this.warnOnce(`Done check: ${errorMessage(error)}`);
      return [];
    }

    if (commands === undefined || commands.length === 0) return [];
    let key: string;
    try {
      key = await approvalKey(this.session.project, ctx.cwd);
    } catch (error) {
      this.warnOnce(`Done check: cannot resolve approval identity: ${errorMessage(error)}`);
      return [];
    }
    if (await isApproved(key, commands)) return commands;
    if (this.declined.has(commands.join("\n"))) return [];
    if (!ctx.hasUI) {
      this.warnOnce(
        `Done check: the commands in ${COMMANDS_FILE} aren't approved, so they don't run. Approve them in pi.`,
      );
      return [];
    }

    const question = [`Done check: run these after each Build run in ${ctx.cwd}?`, ...commands.map((c) => `  ${c}`)];
    const choice = await ctx.ui.select(question.join("\n"), [YES, "No"], { signal: ctx.signal });
    if (choice !== YES) {
      this.declined.add(commands.join("\n"));
      return [];
    }

    await approve(key, commands);
    return commands;
  }

  private warnOnce(message: string) {
    if (this.warned.has(message)) return;

    this.warned.add(message);
    this.session.logWarning(message);
  }

  /** True unless a module answers `mode` with Plan; with no plan-build, every run counts as Build. */
  private async inBuild(): Promise<boolean> {
    const answers = await this.ask("mode", undefined);
    return !answers.some((answer) => answer.kind === "answer" && answer.value === "plan");
  }
}
