import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { Command, ModuleInfo } from "#core/types";
import { ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { BaseModule } from "../base";
import { indexSessions } from "./indexer";
import { failureTotals, navigationTotals, shellTotals, toolTotals, usageTotals } from "./queries";
import type { AnalyticsReport } from "./report";
import { renderAnalyticsReport } from "./report";
import { AnalyticsStore } from "./store";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Local counts read from pi's append-only session files. */
export class AnalyticsModule extends BaseModule {
  private store: AnalyticsStore | undefined;
  private indexing: Promise<void> = Promise.resolve();
  private readonly analyticsCommand = analyticsCmd(async (all) => {
    const store = await this.refresh();
    const since = all ? undefined : Date.now() - SEVEN_DAYS_MS;
    const report: AnalyticsReport = {
      usage: usageTotals(store, since),
      tools: toolTotals(store, since),
      failures: failureTotals(store, since),
      shell: shellTotals(store, since),
      navigation: navigationTotals(store, since),
    };
    return renderAnalyticsReport(report, all ? "all history" : "last 7 days");
  });

  get info(): ModuleInfo {
    return {
      name: "analytics",
      description: "Local counts from session files; /analytics shows tokens, tools, and code navigation",
      commands: [this.analyticsCommand.info],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    void this.refresh().catch((error: unknown) =>
      this.session.logWarning(`Analytics indexing failed: ${errorMessage(error)}`),
    );
    this.session.pi.on("session_shutdown", async () => {
      await this.indexing;
      this.store?.close();
      this.store = undefined;
    });
  }

  commands(): Command[] {
    return [this.analyticsCommand];
  }

  private refresh(): Promise<AnalyticsStore> {
    const ready = this.indexing.then(async () => {
      let store = this.store;
      if (store === undefined) {
        store = new AnalyticsStore(join(getAgentDir(), "analytics", "analytics.sqlite"));
        this.store = store;
      }
      await indexSessions(
        [join(getAgentDir(), "sessions"), join(getAgentDir(), "subagents", "sessions")],
        store,
        homedir(),
      );
      return store;
    });
    // The next pass waits for this one; its failure belongs to `ready`'s caller.
    this.indexing = ready.then(
      () => undefined,
      () => undefined,
    );
    return ready;
  }
}

function analyticsCmd(run: (all: boolean) => Promise<string>): Command {
  return {
    info: {
      name: "analytics",
      description: "Show usage, tools, and code navigation for the last 7 days or all history",
    },
    execute: async (_ctx, args) => {
      try {
        return await run(args[0] === "all");
      } catch (error) {
        return `Analytics indexing failed: ${errorMessage(error)}.`;
      }
    },
  };
}
