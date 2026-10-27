import type { AnalyticsStore } from "./store";

/** Aggregated usage in one provider, model, and thinking-level group. */
export type UsageTotals = {
  provider: string;
  model: string;
  thinking: string;
  replies: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

/** Calls and failures for one tool. */
export type ToolTotals = { tool: string; calls: number; failures: number };

/** One failure text and how often it happened. */
export type FailureTotals = { line: string; count: number };

/** Calls for one shell command name. */
export type ShellTotals = { name: string; calls: number };

/** Code navigation counts in one provider, model, and thinking-level group. */
export type NavigationTotals = {
  provider: string;
  model: string;
  thinking: string;
  lsp: number;
  searches: number;
  fromLineOne: number;
};

/** Usage totals grouped by provider, model, and thinking level since a timestamp. */
export function usageTotals(store: AnalyticsStore, since: number | undefined): UsageTotals[] {
  return store.database
    .prepare(
      `SELECT provider, model, thinking, SUM(is_reply) AS replies, SUM(input) AS input, SUM(output) AS output,
        SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
       FROM usage ${sinceClause(since)}
       GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    )
    .all(...sinceArgs(since)) as UsageTotals[];
}

/** Calls and failures per tool since a timestamp, most called first. */
export function toolTotals(store: AnalyticsStore, since: number | undefined): ToolTotals[] {
  return store.database
    .prepare(
      `SELECT tool, COUNT(*) AS calls, COALESCE(SUM(failed), 0) AS failures
       FROM tool_calls ${sinceClause(since)}
       GROUP BY tool ORDER BY calls DESC, tool`,
    )
    .all(...sinceArgs(since)) as ToolTotals[];
}

/** The most frequent failure texts since a timestamp. */
export function failureTotals(store: AnalyticsStore, since: number | undefined): FailureTotals[] {
  const where = since === undefined ? "failure_line IS NOT NULL" : "failure_line IS NOT NULL AND timestamp >= ?";
  return store.database
    .prepare(
      `SELECT failure_line AS line, COUNT(*) AS count
       FROM tool_calls WHERE ${where}
       GROUP BY failure_line ORDER BY count DESC, line`,
    )
    .all(...sinceArgs(since)) as FailureTotals[];
}

/** Calls per shell command name since a timestamp, most run first. */
export function shellTotals(store: AnalyticsStore, since: number | undefined): ShellTotals[] {
  return store.database
    .prepare(
      `SELECT name, COUNT(*) AS calls
       FROM shell_commands ${sinceClause(since)}
       GROUP BY name ORDER BY calls DESC, name`,
    )
    .all(...sinceArgs(since)) as ShellTotals[];
}

/** LSP calls, code searches, and reads from line 1 per model since a timestamp. */
export function navigationTotals(store: AnalyticsStore, since: number | undefined): NavigationTotals[] {
  const where = since === undefined ? "" : "WHERE c.timestamp >= ?";
  return store.database
    .prepare(
      `SELECT c.provider, c.model, c.thinking,
        SUM(CASE WHEN c.tool = 'lsp' THEN 1 ELSE 0 END) AS lsp,
        SUM(CASE WHEN c.code_search = 1 OR c.tool IN ('grep', 'find') THEN 1 ELSE 0 END) AS searches,
        SUM(CASE WHEN c.tool = 'read' AND c.from_line_one = 1 THEN 1 ELSE 0 END) AS fromLineOne
       FROM tool_calls c ${where}
       GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    )
    .all(...sinceArgs(since)) as NavigationTotals[];
}

function sinceClause(since: number | undefined): string {
  return since === undefined ? "" : "WHERE timestamp >= ?";
}

function sinceArgs(since: number | undefined): number[] {
  return since === undefined ? [] : [since];
}
