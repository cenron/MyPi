import type { ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { steerCompaction } from "./compaction";

/** What goes to the model as a session grows: compaction summaries that keep what MyPi needs. */
export class ContextModule extends BaseModule {
  get info(): ModuleInfo {
    return {
      name: "context",
      description: "Steers compaction summaries to keep decisions, the plan, and the next step.",
      commands: [],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    this.session.pi.on("session_before_compact", (ev, ctx) => this.onBeforeCompact(ev, ctx));
  }

  private onBeforeCompact(ev: SessionBeforeCompactEvent, ctx: ExtensionContext) {
    return steerCompaction(ev, ctx, (message) => this.session.logWarning(message));
  }
}
