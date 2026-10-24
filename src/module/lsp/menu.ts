import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Dialog } from "#ui/components/dialog";
import { ToggleList } from "#ui/components/toggle-list";
import type { ServerStatus } from "./manager";

/**
 * Opens the `/lsp` menu as a centered overlay. Resolves to the ids of the servers to turn off on Save, or `undefined`
 * on Escape.
 */
export async function openLspMenu(ctx: ExtensionContext, statuses: ServerStatus[]): Promise<Set<string> | undefined> {
  if (ctx.mode !== "tui") throw new Error("/lsp requires TUI mode; use /lsp list");

  return ctx.ui.custom<Set<string> | undefined>(
    (_tui, theme: Theme, _keybindings, done) => menu(theme, done, statuses),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: 100, maxHeight: "70%" },
    },
  );
}

/** One line per server, the way the menu and `/lsp list` show it: `TypeScript: running`. */
export function statusLine(status: ServerStatus): string {
  return `${status.spec.language}: ${stateOf(status)}`;
}

/**
 * Builds the dialog. Toggles edit a local copy of the on set, so nothing changes until Save. A server that isn't
 * installed is locked and keeps its setting.
 */
function menu(theme: Theme, done: (off: Set<string> | undefined) => void, statuses: ServerStatus[]) {
  const dialog = new Dialog(theme, { title: "LSP servers" });
  const on = new Set(statuses.filter((status) => status.on).map((status) => status.spec.id));

  const list = new ToggleList(
    theme,
    statuses.map((status) => ({
      id: status.spec.id,
      label: statusLine(status),
      description: details(status),
      on: status.on && status.path !== undefined,
      disabled: status.path === undefined,
    })),
    {
      onToggle: (id, isOn) => (isOn ? on.add(id) : on.delete(id)),
      onAccept: () => done(new Set(statuses.map((status) => status.spec.id).filter((id) => !on.has(id)))),
      onCancel: () => done(undefined),
    },
  );

  dialog.addChild(list);
  return dialog;
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
