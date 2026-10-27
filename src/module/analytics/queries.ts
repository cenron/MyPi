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

export function doneCheckTotals(store: AnalyticsStore, since: number | undefined): DoneCheckTotals[] {
  const where = since === undefined ? "" : "WHERE f.timestamp >= ?";
  return store.database
    .prepare(
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
    )
    .all(...sinceArgs(since)) as DoneCheckTotals[];
}

export function taskTotals(store: AnalyticsStore, since: number | undefined): TaskTotals[] {
  const tools = Object.values(TASK_TOOLS);
  const placeholders = tools.map(() => "?").join(", ");
  const where = since === undefined ? "" : "c.timestamp >= ? AND ";
  return store.database
    .prepare(
      `SELECT c.provider, c.model, c.thinking, COUNT(DISTINCT c.file_path) AS runs, COUNT(*) AS calls
       FROM tool_calls c WHERE ${where}c.tool IN (${placeholders})
       GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    )
    .all(...sinceArgs(since), ...tools) as TaskTotals[];
}

export function subagentTotals(store: AnalyticsStore, since: number | undefined): SubagentTotals[] {
  const where = since === undefined ? "" : "WHERE u.timestamp >= ?";
  return store.database
    .prepare(
      `SELECT COALESCE(parent_call.agent_name, 'unknown') AS agent, u.provider, u.model, u.thinking,
        COUNT(DISTINCT child.file_path) AS runs, SUM(u.cost) AS cost
       FROM usage u JOIN files child ON child.file_path = u.file_path AND child.parent_session IS NOT NULL
       JOIN tool_calls parent_call ON parent_call.file_path = child.parent_session AND parent_call.call_id =
         (SELECT call_id FROM tool_calls candidate WHERE candidate.file_path = child.parent_session
          AND candidate.tool = 'subagent' AND candidate.timestamp <=
            (SELECT MIN(child_usage.timestamp) FROM usage child_usage WHERE child_usage.file_path = child.file_path)
          ORDER BY candidate.timestamp DESC LIMIT 1)
       ${where} GROUP BY agent, u.provider, u.model, u.thinking ORDER BY agent, u.provider, u.model, u.thinking`,
    )
    .all(...sinceArgs(since)) as SubagentTotals[];
}

/** Permission dialogs per model since a timestamp, counted once each however many rules asked. */
export function approvalTotals(store: AnalyticsStore, since: number | undefined): ApprovalTotals[] {
  return store.database
    .prepare(
      `SELECT provider, model, thinking, COUNT(DISTINCT dialog_id) AS dialogs,
        ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no, ${choiceCount("session")} AS session,
        ${choiceCount("no-ui")} AS noUi
       FROM approvals ${sinceClause(since)}
       GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    )
    .all(...sinceArgs(since)) as ApprovalTotals[];
}

/** Permission dialogs per rule since a timestamp, most asked first, with the ones the user refused. */
export function ruleTotals(store: AnalyticsStore, since: number | undefined): RuleTotals[] {
  return store.database
    .prepare(
      `SELECT rule, COUNT(DISTINCT dialog_id) AS dialogs, ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no,
        ${choiceCount("session")} AS session, ${choiceCount("no-ui")} AS noUi
       FROM approvals ${sinceClause(since)}
       GROUP BY rule ORDER BY dialogs DESC, rule`,
    )
    .all(...sinceArgs(since)) as RuleTotals[];
}

function choiceCount(choice: string): string {
  return `COUNT(DISTINCT CASE WHEN choice = '${choice}' THEN dialog_id END)`;
}

function sinceClause(since: number | undefined): string {
  return since === undefined ? "" : "WHERE timestamp >= ?";
}

function sinceArgs(since: number | undefined): number[] {
  return since === undefined ? [] : [since];
}
