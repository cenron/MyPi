import { TASK_TOOLS } from "#core/util/task-tools";
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

/** Calls, failures, and non-zero exits for one tool. */
export type ToolTotals = { tool: string; calls: number; failures: number; exits: number };

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

export type DoneCheckTotals = { provider: string; model: string; thinking: string; reports: number; passes: number };
export type TaskTotals = { provider: string; model: string; thinking: string; runs: number; calls: number };
export type SubagentTotals = {
  agent: string;
  provider: string;
  model: string;
  thinking: string;
  runs: number;
  cost: number;
};

/** Permission dialogs in one provider, model, and thinking-level group, by how each ended. */
export type ApprovalTotals = {
  provider: string;
  model: string;
  thinking: string;
  dialogs: number;
  yes: number;
  no: number;
  session: number;
  noUi: number;
};

/** Permission dialogs one rule asked for, and how many it lost. */
export type RuleTotals = { rule: string; dialogs: number; yes: number; no: number; session: number; noUi: number };

/** When the oldest indexed usage happened, or undefined with none. */
export function historyStart(store: AnalyticsStore): number | undefined {
  const row = store.database.prepare("SELECT MIN(timestamp) AS first FROM usage").get() as { first: number | null };
  return row.first ?? undefined;
}

/** Usage totals grouped by provider, model, and thinking level since a timestamp. */
export function usageTotals(store: AnalyticsStore, since: number | undefined): UsageTotals[] {
  return querySince(
    store,
    `SELECT provider, model, thinking, SUM(is_reply) AS replies, SUM(input) AS input, SUM(output) AS output,
      SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
     FROM usage ${sinceClause(since)}
     GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    since,
  );
}

/** Calls and failures per tool since a timestamp, most called first. */
export function toolTotals(store: AnalyticsStore, since: number | undefined): ToolTotals[] {
  return querySince(
    store,
    `SELECT tool, COUNT(*) AS calls,
      COALESCE(SUM(CASE WHEN failed = 1 AND exited = 0 THEN 1 ELSE 0 END), 0) AS failures,
      COALESCE(SUM(exited), 0) AS exits
     FROM tool_calls ${sinceClause(since)}
     GROUP BY tool ORDER BY calls DESC, tool`,
    since,
  );
}

/** The most frequent failure texts since a timestamp. */
export function failureTotals(store: AnalyticsStore, since: number | undefined): FailureTotals[] {
  return querySince(
    store,
    `SELECT failure_line AS line, COUNT(*) AS count
     FROM tool_calls WHERE failed = 1 AND exited = 0 AND failure_line IS NOT NULL
       ${since === undefined ? "" : "AND timestamp >= ?"}
     GROUP BY failure_line ORDER BY count DESC, line`,
    since,
  );
}

/** Calls per shell command name since a timestamp, most run first. */
export function shellTotals(store: AnalyticsStore, since: number | undefined): ShellTotals[] {
  return querySince(
    store,
    `SELECT name, COUNT(*) AS calls
     FROM shell_commands ${sinceClause(since)}
     GROUP BY name ORDER BY calls DESC, name`,
    since,
  );
}

/** LSP calls, code searches, and reads from line 1 per model since a timestamp. */
export function navigationTotals(store: AnalyticsStore, since: number | undefined): NavigationTotals[] {
  const where = since === undefined ? "" : "WHERE c.timestamp >= ?";
  return querySince(
    store,
    `SELECT c.provider, c.model, c.thinking,
      SUM(CASE WHEN c.tool = 'lsp' THEN 1 ELSE 0 END) AS lsp,
      SUM(CASE WHEN c.code_search = 1 OR c.tool IN ('grep', 'find') THEN 1 ELSE 0 END) AS searches,
      SUM(CASE WHEN c.tool = 'read' AND c.from_line_one = 1 THEN 1 ELSE 0 END) AS fromLineOne
     FROM tool_calls c ${where}
     GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    since,
  );
}

export function doneCheckTotals(store: AnalyticsStore, since: number | undefined): DoneCheckTotals[] {
  const where = since === undefined ? "" : "WHERE f.timestamp >= ?";
  return querySince(
    store,
    `SELECT COALESCE(u.provider, 'unknown') AS provider, COALESCE(u.model, 'unknown') AS model,
      COALESCE(u.thinking, 'unknown') AS thinking,
      SUM(CASE WHEN f.kind = 'done-check-report' THEN 1 ELSE 0 END) AS reports,
      SUM(CASE WHEN f.kind = 'done-check-pass' THEN 1 ELSE 0 END) AS passes
     FROM features f LEFT JOIN usage u ON u.rowid =
       (SELECT previous.rowid FROM usage previous WHERE previous.file_path = f.file_path
        AND (previous.timestamp < f.timestamp OR
          (previous.timestamp = f.timestamp AND previous.position <= f.position))
        ORDER BY previous.timestamp DESC, previous.position DESC LIMIT 1)
     ${where} GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    since,
  );
}

export function taskTotals(store: AnalyticsStore, since: number | undefined): TaskTotals[] {
  const tools = Object.values(TASK_TOOLS);
  const placeholders = tools.map(() => "?").join(", ");
  const where = since === undefined ? "" : "c.timestamp >= ? AND ";
  return querySince(
    store,
    `SELECT c.provider, c.model, c.thinking, COUNT(DISTINCT c.file_path) AS runs, COUNT(*) AS calls
     FROM tool_calls c WHERE ${where}c.tool IN (${placeholders})
     GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    since,
    tools,
  );
}

export function subagentTotals(store: AnalyticsStore, since: number | undefined): SubagentTotals[] {
  const where = since === undefined ? "" : "WHERE u.timestamp >= ?";
  return querySince(
    store,
    `SELECT COALESCE(parent_call.agent_name, 'unknown') AS agent, u.provider, u.model, u.thinking,
      COUNT(DISTINCT child.file_path) AS runs, SUM(u.cost) AS cost
     FROM usage u JOIN files child ON child.file_path = u.file_path AND child.parent_session IS NOT NULL
     JOIN tool_calls parent_call ON parent_call.file_path = child.parent_session AND parent_call.call_id =
       (SELECT call_id FROM tool_calls candidate WHERE candidate.file_path = child.parent_session
        AND candidate.tool = 'subagent' AND candidate.timestamp <=
          (SELECT MIN(child_usage.timestamp) FROM usage child_usage WHERE child_usage.file_path = child.file_path)
        ORDER BY candidate.timestamp DESC LIMIT 1)
     ${where} GROUP BY agent, u.provider, u.model, u.thinking ORDER BY agent, u.provider, u.model, u.thinking`,
    since,
  );
}

/** Permission dialogs per model since a timestamp, counted once each however many rules asked. */
export function approvalTotals(store: AnalyticsStore, since: number | undefined): ApprovalTotals[] {
  return querySince(
    store,
    `SELECT provider, model, thinking, COUNT(DISTINCT dialog_id) AS dialogs,
      ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no, ${choiceCount("session")} AS session,
      ${choiceCount("no-ui")} AS noUi
     FROM approvals ${sinceClause(since)}
     GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    since,
  );
}

/** Permission dialogs per rule since a timestamp, most asked first, with the ones the user refused. */
export function ruleTotals(store: AnalyticsStore, since: number | undefined): RuleTotals[] {
  return querySince(
    store,
    `SELECT rule, COUNT(DISTINCT dialog_id) AS dialogs, ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no,
      ${choiceCount("session")} AS session, ${choiceCount("no-ui")} AS noUi
     FROM approvals ${sinceClause(since)}
     GROUP BY rule ORDER BY dialogs DESC, rule`,
    since,
  );
}

function choiceCount(choice: string): string {
  return `COUNT(DISTINCT CASE WHEN choice = '${choice}' THEN dialog_id END)`;
}

function sinceClause(since: number | undefined): string {
  return since === undefined ? "" : "WHERE timestamp >= ?";
}

function querySince<T>(
  store: AnalyticsStore,
  sql: string,
  since: number | undefined,
  trailingArgs: (string | number)[] = [],
): T[] {
  return store.database.prepare(sql).all(...(since === undefined ? [] : [since]), ...trailingArgs) as T[];
}
