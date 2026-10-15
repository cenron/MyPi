import type { CommandExec } from "#command/types";

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

/** What a module reports about itself; `isLoaded` is set by `loadModules`. */
export type ModuleInfo = {
  name: string;
  description: string;
  commands: CommandInfo[];
  loadType: ModuleLoadMode;
  isLoaded?: boolean;
};
