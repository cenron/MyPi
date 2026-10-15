import type { Session } from "#core/session";
import type { Command, ModuleInfo } from "#core/types";

/** A module class: every module is built as `new Module(session)`. */
export type ModuleBase = new (session: Session) => Module;

/** A feature module. Only loaded modules run `init()`. */
export interface Module {
  readonly session: Session;

  /** Name, description, command infos, and load mode. */
  get info(): ModuleInfo;

  /** Registers event handlers and tools, and restores state. */
  init(): void;

  /** The module's slash commands, registered through `registerCommand`. */
  commands(): Command[];
}
