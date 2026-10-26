import type {
  AgentBeforeSettleEvent,
  AgentBeforeSettleEventResult,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { OpenTask } from "#core/channels";
import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { isPlanMode } from "#core/util/mode";
import { fileChanges, fileTimes } from "#core/util/walk";
import { git } from "#core/worktree/git";
import { FooterColor } from "#ui/footer";
import { BaseModule } from "../base";
import { doneCheckCmd } from "./commands/done-check";
import { reportedDuplicates } from "./duplicates";
import {
  approvalKey,
  approve,
  COMMANDS_FILE,
  type CommandFailure,
  isApproved,
  readCommands,
  runCommand,
} from "./project-commands";
import { changesNotIgnored, doneCheckPassed, doneCheckReport, filesToCheck } from "./report";

/** Most times one run is sent back; after that the agent may stop with whatever is left. */
const MAX_ROUNDS = 3;

/** The report's entry type in the session. */
const REPORT_TYPE = "mypi-done-check";

const YES = "Yes";

/** Untracked files git ignores, a whole ignored folder as one `name/` entry, relative to the folder it runs in. */
const IGNORED_FILES_ARGS = ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"];

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
  /** Duplicate names already reported this session. */
  private reported = new Set<string>();
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
    this.answer("checkCommands", () => this.alreadyApprovedCommands());
  }

  commands(): Command[] {
    return [this.doneCheckCommand];
  }

  /** Records the files' times when a run starts, to find what it changed. */
  private async onRunStart(ctx: ExtensionContext) {
    this.run = { before: await fileTimes(ctx.cwd), rounds: 0 };
  }

  /**
   * The check, as pi's last chance to continue the run. Sends changed-file errors, failed commands, or open tasks back
   * for another model request; a repeated report stops the loop, as pi's docs warn that unconditional continuation
   * loops.
   */
  private async onBeforeSettle(
    ev: AgentBeforeSettleEvent,
    ctx: ExtensionContext,
  ): Promise<AgentBeforeSettleEventResult | undefined> {
    const run = this.run;
    if (!run || ev.outcome !== "completed" || run.rounds >= MAX_ROUNDS) return undefined;
    if (await isPlanMode(this.session.pi.events)) return undefined;

    const openTasks = await this.openTasks();
    const changes = fileChanges(run.before, await fileTimes(ctx.cwd));
    const ignored = changes.length > 0 ? await this.ignoredFiles(ctx) : [];
    const { files, skipped } = filesToCheck(changesNotIgnored(changes, ignored, ctx.cwd));
    if (files.length === 0) {
      return this.continueWithReport(run, doneCheckReport({ problems: [], failures: [], skipped, openTasks }, ctx.cwd));
    }

    const result = await this.check(files, skipped, openTasks, ctx);
    if (result.report !== undefined) return this.continueWithReport(run, result.report);

    const passed = doneCheckPassed(result.sources, result.commands, files.length);
    if (passed === undefined) return undefined;
    return { entries: [{ type: "custom_message", customType: REPORT_TYPE, content: passed, display: true }] };
  }

  /** The report for changed files, approved commands, and any open tasks. */
  private async check(
    files: string[],
    skipped: number,
    openTasks: OpenTask[],
    ctx: ExtensionContext,
  ): Promise<{ report: string | undefined; sources: string[]; commands: string[] }> {
    this.setFooter({ text: "checking…", color: FooterColor.MUTED });
    try {
      const { problems, sources } = await this.problemsIn(files, ctx);
      const duplicates = await this.duplicatesIn(files, ctx);
      const { failures, commands } = await this.runCommands(ctx);
      return {
        report: doneCheckReport({ problems, failures, skipped, openTasks, duplicates }, ctx.cwd),
        sources,
        commands,
      };
    } finally {
      this.setFooter(undefined);
    }
  }

  /**
   * What git ignores under the session's folder, files and whole folders (`coverage/`), so generated files aren't
   * checked. None outside a git project. When git fails, the user is told once and every change is checked.
   */
  private async ignoredFiles(ctx: ExtensionContext): Promise<string[]> {
    if (this.session.project === undefined) return [];

    try {
      return (await git(ctx.cwd, IGNORED_FILES_ARGS)).split("\0").filter(Boolean);
    } catch (error) {
      this.warnOnce(`Done check: couldn't list ignored files; checking all changed files: ${errorMessage(error)}`);
      return [];
    }
  }

  /** New duplicate declarations, only in a Git project and once per name each session. */
  private async duplicatesIn(files: string[], ctx: ExtensionContext) {
    if (this.session.project === undefined) return [];
    const answers = await this.ask("duplicates", { files, signal: ctx.signal });
    for (const answer of answers) {
      if (answer.kind === "failed")
        this.session.logWarning(`Done check: ${answer.from} couldn't check duplicates: ${answer.error}`);
    }
    const duplicates = answers.flatMap((answer) => (answer.kind === "answer" ? answer.value : []));
    const result = reportedDuplicates(duplicates, this.reported);
    this.reported = result.reported;
    return result.duplicates;
  }

  /** The tasks still open according to todo, or none when that module is turned off. */
  private async openTasks(): Promise<OpenTask[]> {
    const answers = await this.ask("openTasks", undefined);
    return answers.flatMap((answer) => (answer.kind === "answer" ? answer.value : []));
  }

  /** Sends one report back, unless it repeats the last one or the round limit is reached. */
  private continueWithReport(run: Run, report: string | undefined): AgentBeforeSettleEventResult | undefined {
    if (report === undefined || report === run.lastReport) return undefined;

    run.rounds++;
    run.lastReport = report;
    return {
      entries: [{ type: "custom_message", customType: REPORT_TYPE, content: report, display: true }],
      continue: true,
    };
  }

  /** Every source's problems in `files`. A source that fails is told to the user, who can fix it; the agent can't. */
  private async problemsIn(files: string[], ctx: ExtensionContext) {
    const answers = await this.ask("diagnostics", { files, signal: ctx.signal });
    for (const answer of answers) {
      if (answer.kind === "failed")
        this.session.logWarning(`Done check: ${answer.from} couldn't check: ${answer.error}`);
    }
    return {
      problems: answers.flatMap((answer) => (answer.kind === "answer" ? answer.value : [])),
      sources: answers.filter((answer) => answer.kind === "answer").map((answer) => answer.from),
    };
  }

  /** Runs the project's approved commands one after another, in its folder; the ones that failed. */
  private async runCommands(ctx: ExtensionContext): Promise<{ failures: CommandFailure[]; commands: string[] }> {
    const commands = await this.approvedCommands(ctx);
    const failures: CommandFailure[] = [];
    for (const command of commands) {
      const failure = await runCommand(command, ctx.cwd, ctx.signal);
      if (failure) failures.push(failure);
    }
    return { failures, commands };
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

  /** The project's commands when the user already approved exactly this list; never asks. */
  private async alreadyApprovedCommands(): Promise<string[]> {
    const cwd = this.session.ctx.cwd;
    const commands = await readCommands(cwd);
    if (commands === undefined || commands.length === 0) return [];
    return (await isApproved(await approvalKey(this.session.project, cwd), commands)) ? commands : [];
  }

  private warnOnce(message: string) {
    if (this.warned.has(message)) return;

    this.warned.add(message);
    this.session.logWarning(message);
  }
}
