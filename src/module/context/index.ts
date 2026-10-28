import type { ContextEvent, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { steerCompaction } from "./compaction";
import { withMidRunNotes } from "./mid-run";
import { oldResultsToClear, withResultsCleared } from "./tool-results";

/**
 * What goes to the model as a session grows: summaries that keep what MyPi needs, old tool results cleared, and messages
 * the user sent mid-run marked so the model acknowledges them.
 */
export class ContextModule extends BaseModule {
  /** Tool calls whose results are cleared. Once cleared, always cleared, so the start of the conversation stays put. */
  private readonly cleared = new Set<string>();

  get info(): ModuleInfo {
    return {
      name: "context",
      description: "Steers compaction summaries, clears old tool results, and marks messages sent mid-run.",
      commands: [],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    this.session.pi.on("session_before_compact", (ev, ctx) => this.onBeforeCompact(ev, ctx));
    this.session.pi.on("context", (ev) => this.onContext(ev));
  }

  private onContext(ev: ContextEvent) {
    for (const id of oldResultsToClear(ev.messages, this.cleared)) {
      this.cleared.add(id);
    }
    return { messages: withMidRunNotes(withResultsCleared(ev.messages, this.cleared)) };
  }

  private onBeforeCompact(ev: SessionBeforeCompactEvent, ctx: ExtensionContext) {
    return steerCompaction(ev, ctx, (message) => this.session.logWarning(message));
  }
}
