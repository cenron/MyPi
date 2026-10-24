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
import { ServerManager } from "./manager";
import { SERVERS } from "./servers";
import { lspTool } from "./tools/lsp";
import { lspEditTool } from "./tools/lsp-edit";

/** What the module saves: the ids of the servers turned off in `/lsp`. */
type LspState = { off: string[] };

export class LspModule extends BaseModule<LspState> {
  readonly servers = new ServerManager(SERVERS, this.session.ctx.cwd, (message) => this.session.logWarning(message));

  // Built once: `info` lists its info.
  private readonly lspCommand = lspCmd(this.servers, (off) => this.saveState({ off: [...off] }));

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

  /** The off set from the session; anything that isn't a list of strings counts as none. */
  private savedOff(): string[] {
    const off = this.loadState()?.off;
    return Array.isArray(off) ? off.filter((id) => typeof id === "string") : [];
  }
}
