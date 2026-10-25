import { homedir } from "node:os";
import {
  type ExtensionContext,
  isEditToolResult,
  isWriteToolResult,
  type ToolDefinition,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { resolveToolPath } from "#core/util/paths";
import { BaseModule } from "../base";
import { lspCmd } from "./commands/lsp";
import { type Lookup, ServerManager } from "./manager";
import { problemsIn } from "./problems";
import { SERVERS } from "./servers";
import { lspTool } from "./tools/lsp";
import { lspEditTool } from "./tools/lsp-edit";

/** What the module saves: the ids of the servers turned off in `/lsp`. */
type LspState = { off: string[] };

export class LspModule extends BaseModule<LspState> {
  readonly servers = new ServerManager(SERVERS, this.session.ctx.cwd, (message) => this.session.logWarning(message));

  // Built once: `info` lists its info.
  private readonly lspCommand = lspCmd(this.servers, (off) => this.saveState({ off: [...off] }));
  /** Servers the user was told the done check can't use, so each is told once a session. */
  private readonly warnedUnavailable = new Set<string>();

  get info(): ModuleInfo {
    return {
      name: "lsp",
      description: "Language servers for code navigation by symbol and diagnostics; /lsp turns them on or off.",
      commands: [this.lspCommand.info],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    // Nothing is running yet, so this only restores the off set.
    void this.servers.setOff(this.savedOff());

    this.session.pi.on("tool_result", (ev, ctx) => this.onToolResult(ev, ctx));
    this.session.pi.on("session_shutdown", () => this.servers.stopAll());
    this.answer("diagnostics", ({ files, signal }) =>
      problemsIn(this.servers, files, (lookup, extension) => this.warnUnavailable(lookup, extension), signal),
    );
  }

  commands(): Command[] {
    return [this.lspCommand];
  }

  tools(): ToolDefinition[] {
    return [lspTool(this.servers), lspEditTool(this.servers)];
  }

  /**
   * Reports a file the agent edited or wrote to the running servers, so a project search sees it. `write` may have
   * created the file, so it's reported as created, which servers also take as "read it again".
   */
  private async onToolResult(ev: ToolResultEvent, ctx: ExtensionContext) {
    if (ev.isError || !(isEditToolResult(ev) || isWriteToolResult(ev))) return;

    const path = ev.input.path;
    if (typeof path !== "string") return;
    await this.servers.fileChanged(resolveToolPath(path, ctx.cwd, homedir()), isWriteToolResult(ev));
  }

  /**
   * Tells the user, once per server, that the done check skips its files because the server isn't installed or
   * failed to start. A server turned off in `/lsp` is the user's choice, so that one is quiet.
   */
  private warnUnavailable(lookup: Exclude<Lookup, { kind: "ready" }>, extension: string) {
    if (lookup.kind !== "missing" && lookup.kind !== "failed") return;
    if (this.warnedUnavailable.has(lookup.spec.id)) return;

    this.warnedUnavailable.add(lookup.spec.id);
    const { command, install } = lookup.spec;
    const why =
      lookup.kind === "missing" ? `${command} isn't installed (${install})` : "its server failed to start; see /lsp";
    this.session.logWarning(`LSP: the done check skips ${extension} files: ${why}.`);
  }

  /** The off set from the session; anything that isn't a list of strings counts as none. */
  private savedOff(): string[] {
    const off = this.loadState()?.off;
    return Array.isArray(off) ? off.filter((id) => typeof id === "string") : [];
  }
}
