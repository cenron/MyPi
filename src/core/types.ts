import type { CommandExec } from "#command/types";
import type { Session } from "./session";

/**
 * When a module loads: `ALWAYS` every time and can't be unloaded, `ON_LOAD` by default, `ON_DEMAND` only when chosen
 * in `/modules`.
 */
export const ModuleLoadMode = {
  ALWAYS: "always",
  ON_LOAD: "on_load",
  ON_DEMAND: "on_demand",
} as const;

export type ModuleLoadMode =
  (typeof ModuleLoadMode)[keyof typeof ModuleLoadMode];

/** A slash command's name (without the `/`) and the description pi shows for it. */
export type CommandInfo = {
  name: string;
  description: string;
};

/** A slash command: registered by `registerCommand` and run through `runCommand`. */
export type Command = {
  info: CommandInfo;
  execute: CommandExec;
};

/** What a module reports about itself; `ModuleManager` sets `isLoaded` (running) and `isSelected` (next reload). */
export type ModuleInfo = {
  name: string;
  description: string;
  commands: CommandInfo[];
  loadType: ModuleLoadMode;
  isLoaded?: boolean;
  isSelected?: boolean;
};

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
