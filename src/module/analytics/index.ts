import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Command, ModuleInfo } from "#core/types";
import { ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { BaseModule } from "../base";
import { indexSessions } from "./indexer";
import { renderAnalyticsReport } from "./report";
import { AnalyticsStore } from "./store";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Local counts read from pi's append-only session files. */
export class AnalyticsModule extends BaseModule {
  private store: AnalyticsStore | undefined;
  private indexing: Promise<void> = Promise.resolve();
  private readonly analyticsCommand = analyticsCmd(async (all) => {
    await this.refresh();
    const since = all ? undefined : Date.now() - SEVEN_DAYS_MS;
    const rows = this.store?.totals(since) ?? [];
    return renderAnalyticsReport(rows, all ? "all history" : "last 7 days");
  });

  get info(): ModuleInfo {
    return {
      name: "analytics",
      description: "Local usage counts from session files; /analytics shows tokens and cost",
      commands: [this.analyticsCommand.info],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    void this.refresh().catch((error: unknown) =>
      this.session.logWarning(`Analytics indexing failed: ${errorMessage(error)}`),
    );
    this.session.pi.on("session_shutdown", () => this.store?.close());
  }

  commands(): Command[] {
    return [this.analyticsCommand];
  }

  private refresh(): Promise<void> {
    this.indexing = this.indexing
      .catch(() => undefined)
      .then(async () => {
        this.store ??= new AnalyticsStore(join(getAgentDir(), "analytics", "analytics.sqlite"));
        await indexSessions(
          [join(getAgentDir(), "sessions"), join(getAgentDir(), "subagents", "sessions")],
          this.store,
        );
      });
    return this.indexing;
  }
}

function analyticsCmd(run: (all: boolean) => Promise<string>): Command {
  return {
    info: { name: "analytics", description: "Show model usage for the last 7 days, or all history" },
    execute: async (_ctx, args) => {
      try {
        return await run(args[0] === "all");
      } catch (error) {
        return `Analytics indexing failed: ${errorMessage(error)}.`;
      }
    },
  };
}
