import type { SessionStartEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Session } from "./session";
import { type Command, type Module, type ModuleInfo, ModuleLoadMode } from "./types";

/** Owns the session's modules: which ones are running, and which the user selected for the next `/reload`. */
export class ModuleManager {
  private modules: Module[] = [];
  /** Decided on `session_start` and fixed until `/reload`. */
  private running = new Set<string>();
  /** The user's choice from `/modules`, applied on the next `/reload`. */
  private selected = new Set<string>();

  constructor(readonly session: Session) {}

  /**
   * Takes the session's modules and picks the ones to load for `reason`. Doesn't run their `init()`: `init()` does,
   * once their tools are registered.
   */
  start(modules: Module[], reason: SessionStartEvent["reason"]) {
    this.modules = modules;

    this.running = this.pickLoaded(
      reason,
      this.savedSelection(),
      modules.map((module) => module.info),
    );
    this.selected = new Set(this.running);
  }

  /**
   * Runs `init()` on the running modules. Call it after `registerTools`: `init()` may turn a module's tools on, and pi
   * ignores tool names that aren't registered yet.
   */
  init() {
    for (const module of this.modules) {
      if (this.running.has(module.info.name)) module.init();
    }
  }

  /** Copies of every module's info, with `isLoaded` (running) and `isSelected` (chosen for the next reload). */
  get moduleInfos(): ModuleInfo[] {
    return this.modules.map((module) => {
      const info = module.info;
      return {
        ...info,
        isLoaded: this.running.has(info.name),
        isSelected: this.selected.has(info.name),
      };
    });
  }

  /** Commands of the running modules only. */
  getCommands(): Command[] {
    return this.modules.filter((module) => this.running.has(module.info.name)).flatMap((module) => module.commands());
  }

  /** Tools of the running modules only. */
  getTools(): ToolDefinition[] {
    return this.modules.filter((module) => this.running.has(module.info.name)).flatMap((module) => module.tools());
  }

  /** Stores the user's selection with every `ALWAYS` module added, and returns it in list order. */
  select(names: Set<string>): string[] {
    // Same rule as restoring a saved set on reload.
    this.selected = this.pickLoaded(
      "reload",
      names,
      this.modules.map((module) => module.info),
    );
    this.session.save("modules", { loaded: [...this.selected] });
    return [...this.selected];
  }

  /** The last saved selection, or `undefined` (the defaults) when nothing valid was saved. */
  private savedSelection(): Set<string> | undefined {
    const saved = this.session.load("modules") as { loaded?: unknown } | undefined;
    if (!Array.isArray(saved?.loaded)) return undefined;
    return new Set(saved.loaded.filter((name) => typeof name === "string"));
  }

  /**
   * Picks the modules to load: every `ALWAYS` module, plus the saved set on `reload`, or the `ON_LOAD` defaults when
   * the reason isn't `reload` or nothing was saved. Saved names that match no module drop out; the result keeps list
   * order.
   */
  private pickLoaded(
    reason: SessionStartEvent["reason"],
    saved: Set<string> | undefined,
    modules: Pick<ModuleInfo, "name" | "loadType">[],
  ): Set<string> {
    const restore = reason === "reload" ? saved : undefined;
    return new Set(
      modules
        .filter(
          (m) =>
            m.loadType === ModuleLoadMode.ALWAYS ||
            (restore ? restore.has(m.name) : m.loadType === ModuleLoadMode.ON_LOAD),
        )
        .map((m) => m.name),
    );
  }
}
