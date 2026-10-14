import type { CommandExec } from "#command/types";

export const ModuleLoadMode = {
  ON_LOAD: "on_load",
  ON_DEMAND: "on_demand",
} as const;

export type ModuleLoadMode =
  (typeof ModuleLoadMode)[keyof typeof ModuleLoadMode];

export type CommandInfo = {
  name: string;
  description: string;
};

export type Command = {
  info: CommandInfo;
  execute: CommandExec;
};

export type ModuleInfo = {
  name: string;
  description: string;
  commands: CommandInfo[];
  loadType: ModuleLoadMode;
  isLoaded?: boolean;
};
