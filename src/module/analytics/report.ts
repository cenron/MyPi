import type { UsageTotals } from "./store";

export type ReportPeriod = "last 7 days" | "all history";

/** Formats model usage as a compact, readable report. */
export function renderAnalyticsReport(rows: readonly UsageTotals[], period: ReportPeriod): string {
  if (rows.length === 0) return "No usage recorded for this period.";

  const lines = [`Model usage · ${period}`];
  for (const row of rows) {
    const cacheShare = row.input + row.cacheRead === 0 ? 0 : row.cacheRead / (row.input + row.cacheRead);
    lines.push(
      `${row.provider}/${row.model} · ${row.thinking}   ${row.replies.toLocaleString("en-US")} replies · ` +
        `in ${formatTokens(row.input)} · out ${formatTokens(row.output)} · cache ${Math.round(cacheShare * 100)}% · ` +
        `$${row.cost.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}
