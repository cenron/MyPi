import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Approval } from "#core/channels";
import type { Command, ModuleInfo } from "#core/types";
import { ModuleLoadMode } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { BaseModule } from "../base";
import { indexSessions } from "./indexer";
import {
  approvalTotals,
  dialogsWithoutProject,
  doneCheckTotals,
  type Filter,
  failureTotals,
  historyStart,
  navigationTotals,
  projectTotals,
  ruleTotals,
  shellTotals,
  subagentTotals,
  taskTotals,
  toolTotals,
  usageTotals,
} from "./queries";
import type { AnalyticsReport, ReportOptions } from "./report";
import { renderAnalyticsReport } from "./report";
import { AnalyticsStore } from "./store";
import { analyticsTool } from "./tools/analytics";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Local counts read from pi's append-only session files. */
export class AnalyticsModule extends BaseModule {
  private store: AnalyticsStore | undefined;
  private indexing: Promise<void> = Promise.resolve();
  private readonly approvalWrites = new Set<Promise<void>>();
  private readonly analyticsCommand = analyticsCmd((options) => this.report(options));

  get info(): ModuleInfo {
    return {
      name: "analytics",
      description: "Local counts from session files; /analytics shows tokens, tools, and code navigation",
      commands: [this.analyticsCommand.info],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    this.setReadable([analyticsDir()]);
    // A permission dialog lives only in the moment it's asked, so it's recorded as the notice arrives.
    this.subscribe("approval", (approval) => this.recordApproval(approval));
    void this.refresh().catch((error: unknown) =>
      this.session.logWarning(`Analytics indexing failed: ${errorMessage(error)}`),
    );
    this.session.pi.on("session_shutdown", async () => {
      await this.indexing;
      await Promise.all(this.approvalWrites);
      this.store?.close();
      this.store = undefined;
    });
  }

  commands(): Command[] {
    return [this.analyticsCommand];
  }

  tools(): ToolDefinition[] {
    return [analyticsTool((options) => this.report(options))];
  }

  /** Refreshes the index and renders the report shared by `/analytics` and the analytics tool. */
  async report(options: ReportOptions): Promise<string> {
    const store = await this.refresh();
    const filter: Filter = {
      since: options.all ? undefined : Date.now() - SEVEN_DAYS_MS,
      project: options.project || undefined,
    };
    const report: AnalyticsReport = {
      usage: usageTotals(store, filter),
      tools: toolTotals(store, filter),
      failures: failureTotals(store, filter),
      shell: shellTotals(store, filter),
      navigation: navigationTotals(store, filter),
      doneChecks: doneCheckTotals(store, filter),
      tasks: taskTotals(store, filter),
      subagents: subagentTotals(store, filter),
      approvals: approvalTotals(store, filter),
      approvalRules: ruleTotals(store, filter),
      skippedSessions: store.skippedCount(),
      project:
        filter.project === undefined
          ? undefined
          : {
              name: filter.project,
              folders: projectTotals(store, filter).map((folder) => ({
                ...folder,
                cwd: folder.cwd.replace(homedir(), "~"),
              })),
            },
      dialogsWithoutProject: dialogsWithoutProject(store, filter),
      historyStart: historyStart(store, filter),
    };
    return renderAnalyticsReport(report, options.all ? "all history" : "last 7 days");
  }

  /** Records the live notice and tracks it so shutdown can't close SQLite before the write finishes. */
  private recordApproval(approval: Approval): void {
    const write = this.open()
      .then((store) => store.recordApproval(approval))
      .catch((error: unknown) =>
        this.session.logWarning(`Analytics couldn't record a permission dialog: ${errorMessage(error)}`),
      );
    this.approvalWrites.add(write);
    void write.then(() => this.approvalWrites.delete(write));
  }

  /** The store, opened once; waits out a running index so a live row can't land in a schema rebuild. */
  private open(): Promise<AnalyticsStore> {
    return this.indexing.then(() => {
      this.store ??= new AnalyticsStore(join(analyticsDir(), "analytics.sqlite"));
      return this.store;
    });
  }

  private refresh(): Promise<AnalyticsStore> {
    const ready = this.open().then(async (store) => {
      await indexSessions(
        [
          { path: join(getAgentDir(), "sessions"), mypiOnly: false },
          // MyPi's subagents write here and nothing else does, so runs from before the marker count too.
          { path: join(getAgentDir(), "subagents", "sessions"), mypiOnly: true },
        ],
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

function analyticsCmd(run: (options: ReportOptions) => Promise<string>): Command {
  return {
    info: {
      name: "analytics",
      description: "Show usage, tools, and code navigation for the last 7 days or all history, for one project or all",
    },
    execute: async (_ctx, args) => {
      const options: ReportOptions = {
        all: args.includes("all"),
        project:
          args
            .filter((word) => word !== "all")
            .join(" ")
            .trim() || undefined,
      };
      try {
        return await run(options);
      } catch (error) {
        return `Analytics indexing failed: ${errorMessage(error)}.`;
      }
    },
  };
}

/** The module's own folder in pi's agent dir, which holds its database. */
function analyticsDir(): string {
  return join(getAgentDir(), "analytics");
}
