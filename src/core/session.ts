import type { ExtensionAPI, ExtensionContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { Editor } from "#ui/editor";
import { Footer } from "#ui/footer";
import { JobManager } from "./job-manager";
import { ModuleManager } from "./module-manager";
import { Notifier } from "./notifier";
import { PromptManager } from "./prompt-manager";
import { ToolGuard } from "./tool-guard";

/** Per-session handle passed to commands and modules: pi's context and API, logging, saved state, and the modules. */
export class Session {
  private readonly _notifier: Notifier;
  private readonly _moduleManager: ModuleManager;
  private readonly _footer: Footer;
  private readonly _editor: Editor;
  private readonly _promptManager: PromptManager;
  private readonly _toolGuard: ToolGuard;
  private readonly _jobs: JobManager;

  constructor(
    readonly ctx: ExtensionContext,
    readonly pi: ExtensionAPI,
  ) {
    this._notifier = new Notifier(this.ctx);
    this._moduleManager = new ModuleManager(this);
    this._footer = new Footer(this.ctx);
    this._editor = new Editor(this.ctx);
    this._promptManager = new PromptManager(this.ctx);
    this._toolGuard = new ToolGuard(this.pi);
    this._jobs = new JobManager();
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
    this._notifier.info(msg);
  }

  logWarning(msg: string) {
    this._notifier.warn(msg);
  }

  logError(msg: string) {
    this._notifier.error(msg);
  }

  /** The session's modules: which are running, and which the user picked for the next `/reload`. */
  get moduleManager(): ModuleManager {
    return this._moduleManager;
  }

  /** MyPi's footer items, by key. Modules set theirs with `BaseModule.setFooter`. */
  get footer(): Footer {
    return this._footer;
  }

  /** MyPi's editor, for key handlers. Modules add theirs with `BaseModule.onKey`. */
  get editor(): Editor {
    return this._editor;
  }

  /** The modules' system prompt sections, written on every run. Modules set theirs with `BaseModule.setPrompt`. */
  get promptManager(): PromptManager {
    return this._promptManager;
  }

  /** Rules that allow, ask about, or block tool calls. Modules add theirs with `BaseModule.onToolCall`. */
  get toolGuard(): ToolGuard {
    return this._toolGuard;
  }

  /** The session's background jobs; every one still running is stopped on `session_shutdown`. */
  get jobs(): JobManager {
    return this._jobs;
  }
}
