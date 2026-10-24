import { type Command, type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { lspCmd } from "./commands/lsp";
import { ServerManager } from "./manager";
import { SERVERS } from "./servers";

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
    this.session.pi.on("session_shutdown", () => this.servers.stopAll());
  }

  commands(): Command[] {
    return [this.lspCommand];
  }

  /** The off set from the session; anything that isn't a list of strings counts as none. */
  private savedOff(): string[] {
    const off = this.loadState()?.off;
    return Array.isArray(off) ? off.filter((id) => typeof id === "string") : [];
  }
}
