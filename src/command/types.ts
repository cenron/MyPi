import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/**
 * Runs a command with the pi command context and the whitespace-split arguments. Returns a message to show as an
 * `info` notification, or `undefined` to show nothing.
 */
export type CommandExec = (ctx: ExtensionCommandContext, args: string[]) => Promise<string | undefined> | string;
