import { TASK_TOOLS } from "#core/util/task-tools";
import type { AnalyticsStore } from "./store";

/** A report's window, and a folder fragment that narrows every query to sessions whose cwd contains it. */
export type Filter = { since?: number; project?: string };

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

/** One folder the filter matched, and how many sessions ran there. */
export type ProjectTotals = { cwd: string; sessions: number };

/** When the oldest indexed usage in the filter happened, or undefined with none. */
export function historyStart(store: AnalyticsStore, filter: Filter): number | undefined {
  const row = store.database
    .prepare(`SELECT MIN(timestamp) AS first FROM usage ${where(sinceClause(filter), projectClause(filter))}`)
    .get(...filterArgs(filter)) as { first: number | null };
  return row.first ?? undefined;
}

/** Usage totals grouped by provider, model, and thinking level in the filter's window. */
export function usageTotals(store: AnalyticsStore, filter: Filter): UsageTotals[] {
  return store.database
    .prepare(
      `SELECT provider, model, thinking, SUM(is_reply) AS replies, SUM(input) AS input, SUM(output) AS output,
        SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
       FROM usage ${where(sinceClause(filter), projectClause(filter))}
       GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    )
    .all(...filterArgs(filter)) as UsageTotals[];
}

/** Calls and failures per tool in the filter's window, most called first. */
export function toolTotals(store: AnalyticsStore, filter: Filter): ToolTotals[] {
  return store.database
    .prepare(
      `SELECT tool, COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN failed = 1 AND exited = 0 THEN 1 ELSE 0 END), 0) AS failures,
        COALESCE(SUM(exited), 0) AS exits
       FROM tool_calls ${where(sinceClause(filter), projectClause(filter))}
       GROUP BY tool ORDER BY calls DESC, tool`,
    )
    .all(...filterArgs(filter)) as ToolTotals[];
}

/** The most frequent failure texts in the filter's window. */
export function failureTotals(store: AnalyticsStore, filter: Filter): FailureTotals[] {
  return store.database
    .prepare(
      `SELECT failure_line AS line, COUNT(*) AS count
       FROM tool_calls ${where("failed = 1", "exited = 0", "failure_line IS NOT NULL", sinceClause(filter), projectClause(filter))}
       GROUP BY failure_line ORDER BY count DESC, line`,
    )
    .all(...filterArgs(filter)) as FailureTotals[];
}

/** Calls per shell command name in the filter's window, most run first. */
export function shellTotals(store: AnalyticsStore, filter: Filter): ShellTotals[] {
  return store.database
    .prepare(
      `SELECT s.name, COUNT(*) AS calls
       FROM shell_commands s
       JOIN tool_calls c ON c.file_path = s.file_path AND c.call_id = s.call_id
       ${where(sinceClause(filter, "s"), projectClause(filter, "c"))}
       GROUP BY s.name ORDER BY calls DESC, s.name`,
    )
    .all(...filterArgs(filter)) as ShellTotals[];
}

/** LSP calls, code searches, and reads from line 1 per model in the filter's window. */
export function navigationTotals(store: AnalyticsStore, filter: Filter): NavigationTotals[] {
  return store.database
    .prepare(
      `SELECT c.provider, c.model, c.thinking,
        SUM(CASE WHEN c.tool = 'lsp' THEN 1 ELSE 0 END) AS lsp,
        SUM(CASE WHEN c.code_search = 1 OR c.tool IN ('grep', 'find') THEN 1 ELSE 0 END) AS searches,
        SUM(CASE WHEN c.tool = 'read' AND c.from_line_one = 1 THEN 1 ELSE 0 END) AS fromLineOne
       FROM tool_calls c ${where(sinceClause(filter, "c"), projectClause(filter, "c"))}
       GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    )
    .all(...filterArgs(filter)) as NavigationTotals[];
}

export function doneCheckTotals(store: AnalyticsStore, filter: Filter): DoneCheckTotals[] {
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
       ${where(sinceClause(filter, "f"), projectClause(filter, "u"))}
       GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    )
    .all(...filterArgs(filter)) as DoneCheckTotals[];
}

export function taskTotals(store: AnalyticsStore, filter: Filter): TaskTotals[] {
  const tools = Object.values(TASK_TOOLS);
  const placeholders = tools.map(() => "?").join(", ");
  return store.database
    .prepare(
      `SELECT c.provider, c.model, c.thinking, COUNT(DISTINCT c.file_path) AS runs, COUNT(*) AS calls
       FROM tool_calls c ${where(sinceClause(filter, "c"), projectClause(filter, "c"), `c.tool IN (${placeholders})`)}
       GROUP BY c.provider, c.model, c.thinking ORDER BY c.provider, c.model, c.thinking`,
    )
    .all(...filterArgs(filter), ...tools) as TaskTotals[];
}

export function subagentTotals(store: AnalyticsStore, filter: Filter): SubagentTotals[] {
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
       ${where(sinceClause(filter, "u"), projectClause(filter, "u"))}
       GROUP BY agent, u.provider, u.model, u.thinking ORDER BY agent, u.provider, u.model, u.thinking`,
    )
    .all(...filterArgs(filter)) as SubagentTotals[];
}

/** Permission dialogs per model in the filter's window, counted once each however many rules asked. */
export function approvalTotals(store: AnalyticsStore, filter: Filter): ApprovalTotals[] {
  return store.database
    .prepare(
      `SELECT provider, model, thinking, COUNT(DISTINCT dialog_id) AS dialogs,
        ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no, ${choiceCount("session")} AS session,
        ${choiceCount("no-ui")} AS noUi
       FROM approvals ${where(sinceClause(filter), projectClause(filter))}
       GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
    )
    .all(...filterArgs(filter)) as ApprovalTotals[];
}

/** Permission dialogs per rule in the filter's window, most asked first, with the ones the user refused. */
export function ruleTotals(store: AnalyticsStore, filter: Filter): RuleTotals[] {
  return store.database
    .prepare(
      `SELECT rule, COUNT(DISTINCT dialog_id) AS dialogs, ${choiceCount("yes")} AS yes, ${choiceCount("no")} AS no,
        ${choiceCount("session")} AS session, ${choiceCount("no-ui")} AS noUi
       FROM approvals ${where(sinceClause(filter), projectClause(filter))}
       GROUP BY rule ORDER BY dialogs DESC, rule`,
    )
    .all(...filterArgs(filter)) as RuleTotals[];
}

/** Every folder the filter matched, by session count, so an over-matching fragment is visible. */
export function projectTotals(store: AnalyticsStore, filter: Filter): ProjectTotals[] {
  return store.database
    .prepare(
      `SELECT cwd, COUNT(DISTINCT file_path) AS sessions
       FROM usage ${where(sinceClause(filter), projectClause(filter))}
       GROUP BY cwd ORDER BY sessions DESC, cwd`,
    )
    .all(...filterArgs(filter)) as ProjectTotals[];
}

/** Dialogs recorded before the store kept each one's folder, which a project report can't count. */
export function dialogsWithoutProject(store: AnalyticsStore, filter: Filter): number {
  const row = store.database
    .prepare(`SELECT COUNT(DISTINCT dialog_id) AS count FROM approvals ${where("cwd IS NULL", sinceClause(filter))}`)
    .get(...sinceArgs(filter)) as { count: number };
  return row.count;
}

/** A folder fragment as a case-insensitive `LIKE` pattern, with the wildcards it may contain escaped. */
export function projectPattern(project: string): string {
  return `%${project.replace(/[\\%_]/g, "\\$&")}%`;
}

function choiceCount(choice: string): string {
  return `COUNT(DISTINCT CASE WHEN choice = '${choice}' THEN dialog_id END)`;
}

function where(...clauses: string[]): string {
  const present = clauses.filter((clause) => clause !== "");
  return present.length === 0 ? "" : `WHERE ${present.join(" AND ")}`;
}

function sinceClause(filter: Filter, alias?: string): string {
  if (filter.since === undefined) return "";
  return `${alias === undefined ? "" : `${alias}.`}timestamp >= ?`;
}

function projectClause(filter: Filter, alias?: string): string {
  if (filter.project === undefined) return "";
  return `${alias === undefined ? "" : `${alias}.`}cwd LIKE ? ESCAPE '\\'`;
}

function filterArgs(filter: Filter): (string | number)[] {
  const args: (string | number)[] = [];
  if (filter.since !== undefined) args.push(filter.since);
  if (filter.project !== undefined) args.push(projectPattern(filter.project));
  return args;
}

function sinceArgs(filter: Filter): number[] {
  return filter.since === undefined ? [] : [filter.since];
}
