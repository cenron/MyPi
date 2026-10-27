import type { ExtensionAPI, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { Editor } from "#ui/editor";
import { Footer } from "#ui/footer";
import { jobsLine } from "#ui/jobs-line";
import { subscribe } from "./events";
import { JobManager } from "./job-manager";
import { ModuleManager } from "./module-manager";
import { Notifier } from "./notifier";
import { PromptManager } from "./prompt-manager";
import { ToolGuard } from "./tool-guard";
import { type Project, Worktrees } from "./worktree";

/** Per-session handle passed to commands and modules: pi's context and API, logging, saved state, and the modules. */
export class Session {
  /** The session's modules: which are running, and which the user picked for the next `/reload`. */
  readonly moduleManager: ModuleManager;
  /** MyPi's footer items, by key. Modules set theirs with `BaseModule.setFooter`. */
  readonly footer: Footer;
  /** MyPi's editor, for key handlers. Modules add theirs with `BaseModule.onKey`. */
  readonly editor: Editor;
  /** The modules' system prompt sections, written on every run. Modules set theirs with `BaseModule.setPrompt`. */
  readonly promptManager: PromptManager;
  /** Rules that allow, ask about, or block tool calls. Modules add theirs with `BaseModule.onToolCall`. */
  readonly toolGuard: ToolGuard;
  /** The session's background jobs; every one still running is stopped on `session_shutdown`. */
  readonly jobs: JobManager;
  /** Lazy Git worktree operations rooted in this session's cwd; never switch the session. */
  readonly worktrees: Worktrees;
  /** Where MyPi keeps a project's `.pi/` state: the main checkout in git, else the session's folder. */
  readonly projectRoot: string;
  private readonly notifier: Notifier;
  private jobsInterval: ReturnType<typeof setInterval> | undefined;

  constructor(
    readonly ctx: ExtensionContext,
    readonly pi: ExtensionAPI,
    /** Resolved before construction; undefined outside Git or when discovery failed. */
    readonly project: Project | undefined,
  ) {
    this.projectRoot = project?.main ?? ctx.cwd;
    this.notifier = new Notifier(ctx);
    this.moduleManager = new ModuleManager(this);
    this.footer = new Footer(ctx);
    this.editor = new Editor(ctx);
    this.promptManager = new PromptManager();
    this.toolGuard = new ToolGuard(pi);
    this.jobs = new JobManager(pi.events);
    this.worktrees = new Worktrees(ctx.cwd);
    subscribe(pi.events, "jobs", (running) => this.updateJobsWidget(running));
    pi.on("session_shutdown", () => this.clearJobsWidget());
  }

  /** Saves `data` in the session as a `mypi-<name>` entry; not sent to the model. Modules use `BaseModule.saveState`. */
  save(name: string, data: unknown) {
    this.pi.appendEntry(`mypi-${name}`, data);
  }

  /**
   * Like `save`, but into another session, such as a new one in `ctx.newSession({ setup })`, which runs before that
   * session's `session_start`, so its modules load the entry in `init()`.
   */
  saveTo(sessionManager: SessionManager, name: string, data: unknown) {
    sessionManager.appendCustomEntry(`mypi-${name}`, data);
  }

  /** The last `mypi-<name>` entry's data on the current branch, or undefined. The file can hold anything. */
  load(name: string): unknown {
    let data: unknown;
    for (const entry of this.ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === `mypi-${name}`) data = entry.data;
    }
    return data;
  }

  log(msg: string) {
    this.notifier.info(msg);
  }

  logWarning(msg: string) {
    this.notifier.warn(msg);
  }

  logError(msg: string) {
    this.notifier.error(msg);
  }

  private updateJobsWidget(running: number) {
    if (!this.ctx.hasUI) return;

    if (!running) {
      this.clearJobsWidget();
      return;
    }

    const draw = () => {
      const jobs = this.jobs.list().filter((job) => job.status === "running");
      this.ctx.ui.setWidget("mypi-jobs", jobsLine(jobs, this.ctx.ui.theme), { placement: "belowEditor" });
      if (!jobs.length) this.clearJobsWidget();
    };

    draw();
    this.jobsInterval ??= setInterval(draw, 1000);
  }

  private clearJobsWidget() {
    if (this.jobsInterval) clearInterval(this.jobsInterval);
    this.jobsInterval = undefined;
    if (this.ctx.hasUI) this.ctx.ui.setWidget("mypi-jobs", undefined, { placement: "belowEditor" });
  }
}
