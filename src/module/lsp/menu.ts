import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { openToggleDialog } from "#ui/components/toggle-dialog";
import type { ServerStatus } from "./manager";

/**
 * Opens the `/lsp` menu as a centered overlay. Resolves to the ids of the servers to turn off on Save, or `undefined`
 * on Escape.
 */
export async function openLspMenu(ctx: ExtensionContext, statuses: ServerStatus[]): Promise<Set<string> | undefined> {
  if (ctx.mode !== "tui") throw new Error("/lsp requires TUI mode; use /lsp list");

  const on = await openToggleDialog(
    ctx,
    "LSP servers",
    statuses.map((status) => ({
      id: status.spec.id,
      label: statusLine(status),
      description: details(status),
      on: status.on && status.path !== undefined,
      disabled: status.path === undefined,
    })),
  );
  if (on === undefined) return undefined;

  // A server that isn't installed is locked and shown off, but keeps its setting.
  const turnedOff = (status: ServerStatus) => (status.path === undefined ? !status.on : !on.has(status.spec.id));
  return new Set(statuses.filter(turnedOff).map((status) => status.spec.id));
}

/** One line per server, the way the menu and `/lsp list` show it: `TypeScript: running`. */
export function statusLine(status: ServerStatus): string {
  return `${status.spec.language}: ${stateOf(status)}`;
}

/** The state word: what's installed, then what's on, then what's running. */
function stateOf(status: ServerStatus): string {
  if (status.path === undefined) return "not installed";
  if (!status.on) return "off";
  if (status.running.length > 0) return "running";
  if (status.starting.length > 0) return "starting";
  if (status.failed.length > 0) return "failed";
  return "installed";
}

/** The selected row's description: how to install it, or the command and where it runs or failed. */
function details(status: ServerStatus): string {
  const { spec } = status;
  if (status.path === undefined) return `Install: ${spec.install}`;

  const lines = [`${status.path} ${spec.args.join(" ")}`];
  for (const root of status.running) lines.push(`Running in ${root}`);
  for (const root of status.starting) lines.push(`Starting in ${root}`);
  for (const { root, error } of status.failed) lines.push(`Failed in ${root}: ${error.split("\n")[0]}`);
  if (lines.length === 1 && status.on) lines.push(`Starts on first use.`);
  return lines.join("\n");
}
