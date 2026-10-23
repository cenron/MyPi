import type { ExtensionCommandContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
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

export type ModuleLoadMode = (typeof ModuleLoadMode)[keyof typeof ModuleLoadMode];

/** A slash command's name (without the `/`) and the description pi shows for it. */
export type CommandInfo = {
  name: string;
  description: string;
};

/**
 * Runs a command with the pi command context and the whitespace-split arguments. Returns a message to show as an
 * `info` notification, or `undefined` to show nothing.
 */
export type CommandExec = (ctx: ExtensionCommandContext, args: string[]) => Promise<string | undefined> | string;

/** A slash command: registered by `registerCommands` and run through `runCommand`. */
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
export type ModuleClass = new (session: Session) => Module;

/** A feature module. Only loaded modules run `init()`. Modules extend `BaseModule` (`src/module/base.ts`). */
export interface Module {
  readonly session: Session;

  /** Name, description, command infos, and load mode. */
  get info(): ModuleInfo;

  /** Registers event handlers, turns its tools on or off, and restores state. Runs after every tool is registered. */
  init(): void;

  /** The module's slash commands, registered through `registerCommands`. */
  commands(): Command[];

  /** The module's tools, registered through `registerTools` before `init()`. Wrap each in `defineTool`. */
  tools(): ToolDefinition[];
}

/** How a job stands: running, or how it ended. */
export type JobStatus = "running" | "completed" | "failed" | "stopped";

/** A job as the registry reports it. */
export type JobInfo = {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** The exit code `run` resolved to; missing while running, when stopped, or when `run` threw. */
  exitCode?: number;
  /** Why `run` threw, when it did. */
  error?: string;
  /** The file every byte of output goes to, kept after the job ends. */
  logPath: string;
};

/** What to run. `kind` is `shell` today, and `subagent` later. */
export type JobSpec = {
  kind: string;
  /** What the job is, for lists and notices, such as the command. */
  label: string;
  /**
   * Runs until it ends: writes output with `write`, resolves to an exit code (0 is success), and stops when `signal`
   * aborts.
   */
  run(signal: AbortSignal, write: (chunk: Buffer | string) => void): Promise<number>;
};

/** A started job: its info as it changes, a promise that settles once it has ended, and its last output lines. */
export type Job = { readonly info: JobInfo; readonly done: Promise<JobInfo>; tail(lines: number): string };
