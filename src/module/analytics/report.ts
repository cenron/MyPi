import type {
  ApprovalTotals,
  DoneCheckTotals,
  FailureTotals,
  NavigationTotals,
  ProjectTotals,
  RuleTotals,
  ShellTotals,
  SubagentTotals,
  TaskTotals,
  ToolTotals,
  UsageTotals,
} from "./queries";

const MAX_FAILURE_LINES = 5;
const MAX_SHELL_COMMANDS = 8;
const MAX_PROJECT_FOLDERS = 3;
const COMMANDS_WITH_TOOLS = new Set(["grep", "find", "ls", "cat"]);

type ReportPeriod = "last 7 days" | "all history";

/** What a caller asks for: a window, and optionally one project's folder fragment. */
export type ReportOptions = { all: boolean; project?: string };

/** Every counted measure the report shows, read from the store and rendered together. */
export type AnalyticsReport = {
  usage: readonly UsageTotals[];
  tools: readonly ToolTotals[];
  failures: readonly FailureTotals[];
  shell: readonly ShellTotals[];
  navigation: readonly NavigationTotals[];
  doneChecks: readonly DoneCheckTotals[];
  tasks: readonly TaskTotals[];
  subagents: readonly SubagentTotals[];
  approvals: readonly ApprovalTotals[];
  approvalRules: readonly RuleTotals[];
  skippedSessions: number;
  /** The project the report was narrowed to, and the folders the fragment matched. */
  project?: { name: string; folders: readonly ProjectTotals[] };
  /** Dialogs recorded before each one's folder was kept, so a project report can't count them. */
  dialogsWithoutProject: number;
  /** When the oldest indexed usage happened: how far back "all history" goes. */
  historyStart: number | undefined;
};

/** Formats the counted measures as a plain-text report, one section per question. */
export function renderAnalyticsReport(report: AnalyticsReport, period: ReportPeriod): string {
  const sections: string[] = [];
  const project = projectLines(report.project);
  if (project !== undefined) sections.push(project);
  if (report.usage.length > 0) sections.push(modelLines(report.usage, period, report.historyStart));
  if (report.tools.length > 0) sections.push(toolLines(report.tools));
  if (report.failures.length > 0) sections.push(failureLines(report.failures));
  const shell = shellLines(report.shell);
  if (shell !== undefined) sections.push(shell);
  const navigation = navigationLines(report.navigation);
  if (navigation !== undefined) sections.push(navigation);
  const features = featureLines(report);
  if (features !== undefined) sections.push(features);
  const friction = frictionLines(report.approvals, report.approvalRules);
  if (friction !== undefined) sections.push(friction);
  if (report.project !== undefined && report.dialogsWithoutProject > 0) {
    const dialogs = report.dialogsWithoutProject;
    sections.push(
      `${formatCount(dialogs, "permission dialog")} recorded before projects were kept ` +
        `${dialogs === 1 ? "isn't" : "aren't"} counted here.`,
    );
  }
  if (report.skippedSessions > 0) {
    sections.push(`${formatCount(report.skippedSessions, "other pi session")} skipped`);
  }
  return sections.length === 0 ? emptyReport(report.project?.name) : sections.join("\n\n");
}

/** The fragment's match, so an over-matching name shows every folder it pulled in. */
function projectLines(project: AnalyticsReport["project"]): string | undefined {
  if (project === undefined || project.folders.length === 0) return undefined;
  const sessions = project.folders.reduce((sum, folder) => sum + folder.sessions, 0);
  const lines = [
    `Project "${project.name}" · ${formatCount(project.folders.length, "folder")}, ` +
      `${formatCount(sessions, "session")}`,
  ];
  for (const folder of project.folders.slice(0, MAX_PROJECT_FOLDERS)) {
    lines.push(`  ${folder.cwd} (${folder.sessions})`);
  }
  const more = project.folders.length - MAX_PROJECT_FOLDERS;
  if (more > 0) lines.push(`  +${more} more`);
  return lines.join("\n");
}

function emptyReport(project: string | undefined): string {
  return project === undefined
    ? "No usage recorded for this period."
    : `No usage recorded for project "${project}" in this period.`;
}

function modelLines(rows: readonly UsageTotals[], period: ReportPeriod, historyStart: number | undefined): string {
  const width = Math.max(...rows.map((row) => modelLabel(row).length));
  // The start date says how much history there is, so "all history" after a fresh start isn't read as months.
  const since = historyStart === undefined ? "" : ` · history from ${localDate(historyStart)}`;
  const lines = [`Model usage · ${period}${since}`];
  for (const row of rows) {
    const cacheShare = row.input + row.cacheRead === 0 ? 0 : row.cacheRead / (row.input + row.cacheRead);
    lines.push(
      `${modelLabel(row).padEnd(width)}   ${formatReplies(row.replies)} · ` +
        `in ${formatTokens(row.input)} · out ${formatTokens(row.output)} · cache ${Math.round(cacheShare * 100)}% · ` +
        `$${row.cost.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}

function toolLines(rows: readonly ToolTotals[]): string {
  const width = Math.max(...rows.map((row) => row.tool.length));
  const lines = ["Tools"];
  for (const row of rows) {
    const failures = `${formatShare(row.failures, row.calls)} failed`;
    const exits = row.exits > 0 ? ` · ${formatShare(row.exits, row.calls)} exited non-zero` : "";
    lines.push(`${row.tool.padEnd(width)} ${formatCount(row.calls, "call")} · ${failures}${exits}`);
  }
  return lines.join("\n");
}

function failureLines(rows: readonly FailureTotals[]): string {
  const lines = ["Top failure lines"];
  for (const row of rows.slice(0, MAX_FAILURE_LINES)) {
    lines.push(`${String(row.count).padStart(4)}  ${row.line}`);
  }
  return lines.join("\n");
}

function shellLines(rows: readonly ShellTotals[]): string | undefined {
  const withoutTool = rows.filter((row) => !COMMANDS_WITH_TOOLS.has(row.name));
  if (withoutTool.length === 0) return undefined;

  const shown = withoutTool.slice(0, MAX_SHELL_COMMANDS);
  const width = Math.max(...shown.map((row) => row.name.length));
  const lines = ["Shell commands with no tool"];
  for (const row of shown) {
    lines.push(`${row.name.padEnd(width)} ${formatCount(row.calls, "call")}`);
  }
  return lines.join("\n");
}

function navigationLines(rows: readonly NavigationTotals[]): string | undefined {
  const shown = rows.filter((row) => row.lsp + row.searches + row.fromLineOne > 0);
  if (shown.length === 0) return undefined;

  const width = Math.max(...shown.map((row) => modelLabel(row).length));
  const lines = ["Code navigation"];
  for (const row of shown) {
    lines.push(
      `${modelLabel(row).padEnd(width)}   ${formatCount(row.lsp, "lsp", "lsp")} · ` +
        `${formatCount(row.searches, "code search", "code searches")} · ` +
        `${formatCount(row.fromLineOne, "read from line 1", "reads from line 1")} · ` +
        `lsp share ${formatShare(row.lsp, row.lsp + row.searches)}`,
    );
  }
  return lines.join("\n");
}

function featureLines(report: AnalyticsReport): string | undefined {
  const lines = ["MyPi features"];
  for (const row of report.doneChecks) {
    lines.push(
      `${modelLabel(row)}   ${formatCount(row.reports, "done-check report")} · ${formatCount(row.passes, "pass", "passes")}`,
    );
  }
  for (const row of report.tasks) {
    lines.push(`${modelLabel(row)}   ${formatCount(row.runs, "task-tool run")} · ${formatCount(row.calls, "call")}`);
  }
  for (const row of report.subagents) {
    lines.push(
      `${row.agent} · ${modelLabel(row)}   ${formatCount(row.runs, "run")} · $${row.cost.toFixed(2)} child cost`,
    );
  }
  return lines.length === 1 ? undefined : lines.join("\n");
}

/** The dialogs each model ran into, by choice, then each rule that asked and how often it lost. */
function frictionLines(approvals: readonly ApprovalTotals[], rules: readonly RuleTotals[]): string | undefined {
  if (approvals.length === 0) return undefined;

  const width = Math.max(...approvals.map((row) => modelLabel(row).length));
  const lines = ["Permission dialogs"];
  for (const row of approvals) {
    lines.push(
      `${modelLabel(row).padEnd(width)}   ${formatCount(row.dialogs, "dialog")} · yes ${row.yes} · no ${row.no} · ` +
        `session ${row.session} · no UI ${row.noUi}`,
    );
  }
  const ruleWidth = Math.max(...rules.map((row) => row.rule.length));
  for (const row of rules) {
    lines.push(
      `  ${row.rule.padEnd(ruleWidth)} ${formatCount(row.dialogs, "dialog")} · yes ${row.yes} · no ${row.no} · ` +
        `session ${row.session} · no UI ${row.noUi}`,
    );
  }
  return lines.join("\n");
}

function modelLabel(row: { provider: string; model: string; thinking: string }): string {
  return `${row.provider}/${row.model} · ${row.thinking}`;
}

function formatReplies(count: number): string {
  return formatCount(count, "reply", "replies");
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function formatShare(part: number, whole: number): string {
  return `${whole === 0 ? 0 : Math.round((part / whole) * 100)}%`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** A timestamp's local date as `YYYY-MM-DD` (the `en-CA` locale writes dates that way). */
function localDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-CA");
}
