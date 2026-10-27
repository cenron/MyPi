import type {
  DoneCheckTotals,
  FailureTotals,
  NavigationTotals,
  ShellTotals,
  SubagentTotals,
  TaskTotals,
  ToolTotals,
  UsageTotals,
} from "./queries";

const MAX_FAILURE_LINES = 5;
const MAX_SHELL_COMMANDS = 8;
const COMMANDS_WITH_TOOLS = new Set(["grep", "find", "ls", "cat"]);

export type ReportPeriod = "last 7 days" | "all history";

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
  skippedSessions: number;
};

/** Formats the counted measures as a plain-text report, one section per question. */
export function renderAnalyticsReport(report: AnalyticsReport, period: ReportPeriod): string {
  const sections: string[] = [];
  if (report.usage.length > 0) sections.push(modelLines(report.usage, period));
  if (report.tools.length > 0) sections.push(toolLines(report.tools));
  if (report.failures.length > 0) sections.push(failureLines(report.failures));
  const shell = shellLines(report.shell);
  if (shell !== undefined) sections.push(shell);
  const navigation = navigationLines(report.navigation);
  if (navigation !== undefined) sections.push(navigation);
  const features = featureLines(report);
  if (features !== undefined) sections.push(features);
  if (report.skippedSessions > 0) {
    sections.push(`${formatCount(report.skippedSessions, "other pi session")} skipped`);
  }
  return sections.length === 0 ? "No usage recorded for this period." : sections.join("\n\n");
}

function modelLines(rows: readonly UsageTotals[], period: ReportPeriod): string {
  const width = Math.max(...rows.map((row) => modelLabel(row).length));
  const lines = [`Model usage · ${period}`];
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
    lines.push(
      `${row.tool.padEnd(width)} ${formatCount(row.calls, "call")} · ${formatShare(row.failures, row.calls)} failed`,
    );
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
