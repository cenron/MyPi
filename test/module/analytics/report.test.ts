import { describe, expect, it } from "vitest";
import { renderAnalyticsReport } from "#module/analytics/report";
import type { UsageTotals } from "#module/analytics/store";

function totals(input: number, output: number, cacheRead = 0, replies = 1, cost = 3.99): UsageTotals {
  return {
    provider: "openai",
    model: "gpt-6-luna",
    thinking: "high",
    replies,
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    cost,
  };
}

describe("renderAnalyticsReport", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1200, "1.2k"],
    [10000, "10k"],
    [999999, "1000k"],
    [1500000, "1.5M"],
    [10000000, "10M"],
  ])("formats %i tokens as %s", (count, formatted) => {
    const report = renderAnalyticsReport([totals(0, count)], "all history");
    expect(report).toContain(`out ${formatted}`);
  });

  it("renders a compact line with rounded reply count, cache share, and cost", () => {
    expect(renderAnalyticsReport([totals(100000, 9600000, 2400000, 3980)], "last 7 days")).toBe(
      "Model usage · last 7 days\nopenai/gpt-6-luna · high   3,980 replies · in 100k · out 9.6M · cache 96% · $3.99",
    );
  });

  it("reports when there are no usage rows", () => {
    expect(renderAnalyticsReport([], "all history")).toBe("No usage recorded for this period.");
  });
});
