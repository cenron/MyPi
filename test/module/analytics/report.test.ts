import { describe, expect, it } from "vitest";
import type { UsageTotals } from "#module/analytics/queries";
import type { AnalyticsReport } from "#module/analytics/report";
import { renderAnalyticsReport } from "#module/analytics/report";

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

function report(overrides: Partial<AnalyticsReport>): AnalyticsReport {
  return {
    usage: [],
    tools: [],
    failures: [],
    shell: [],
    navigation: [],
    doneChecks: [],
    tasks: [],
    subagents: [],
    approvals: [],
    approvalRules: [],
    skippedSessions: 0,
    historyStart: undefined,
    ...overrides,
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
    const text = renderAnalyticsReport(report({ usage: [totals(0, count)] }), "all history");
    expect(text).toContain(`out ${formatted}`);
  });

  it("renders a compact model line with rounded reply count, cache share, and cost", () => {
    const text = renderAnalyticsReport(report({ usage: [totals(100000, 9600000, 2400000, 3980)] }), "last 7 days");
    expect(text).toContain(
      "Model usage · last 7 days\nopenai/gpt-6-luna · high   3,980 replies · in 100k · out 9.6M · cache 96% · $3.99",
    );
  });

  it("names the day the indexed history starts", () => {
    const historyStart = new Date(2026, 9, 27, 12).getTime();
    const text = renderAnalyticsReport(report({ usage: [totals(10, 2)], historyStart }), "all history");
    expect(text).toContain("Model usage · all history · history from 2026-10-27\n");
  });

  it("writes one reply in the singular", () => {
    const text = renderAnalyticsReport(report({ usage: [totals(10, 2)] }), "last 7 days");
    expect(text).toContain("1 reply ·");
  });

  it("renders tools, the most frequent failures, shell commands, and code navigation", () => {
    const text = renderAnalyticsReport(
      report({
        tools: [
          { tool: "read", calls: 1, failures: 0, exits: 0 },
          { tool: "bash", calls: 4, failures: 1, exits: 0 },
          { tool: "subagent_apply", calls: 2, failures: 0, exits: 0 },
        ],
        failures: [
          { line: "boom", count: 2 },
          { line: "bang", count: 1 },
        ],
        shell: [
          { name: "grep", calls: 7 },
          { name: "node", calls: 5 },
          { name: "git", calls: 3 },
        ],
        navigation: [
          {
            provider: "openai",
            model: "gpt-6-luna",
            thinking: "high",
            lsp: 1,
            searches: 2,
            fromLineOne: 3,
          },
          {
            provider: "openai",
            model: "gpt-6.1-sol",
            thinking: "medium",
            lsp: 0,
            searches: 0,
            fromLineOne: 2,
          },
          { provider: "openai", model: "gpt-5", thinking: "low", lsp: 0, searches: 0, fromLineOne: 0 },
        ],
      }),
      "all history",
    );

    expect(text).toContain(
      "Tools\nread           1 call · 0% failed\nbash           4 calls · 25% failed\n" +
        "subagent_apply 2 calls · 0% failed",
    );
    expect(text).toContain("Top failure lines\n   2  boom\n   1  bang");
    expect(text).toContain("Shell commands with no tool\nnode 5 calls\ngit  3 calls");
    expect(text).not.toContain("grep");
    expect(text).toContain(
      "Code navigation\nopenai/gpt-6-luna · high      1 lsp · 2 code searches · 3 reads from line 1 · lsp share 33%",
    );
    expect(text).toContain(
      "openai/gpt-6.1-sol · medium   0 lsp · 0 code searches · 2 reads from line 1 · lsp share 0%",
    );
    expect(text).not.toContain("gpt-5");
  });

  it("shows non-zero exits beside failures only when present", () => {
    const text = renderAnalyticsReport(
      report({
        tools: [
          { tool: "bash", calls: 120, failures: 5, exits: 18 },
          { tool: "read", calls: 1, failures: 0, exits: 0 },
        ],
      }),
      "all history",
    );
    expect(text).toContain("bash 120 calls · 4% failed · 15% exited non-zero");
    expect(text).toContain("read 1 call · 0% failed");
    expect(text).not.toContain("read 1 call · 0% failed · 0% exited non-zero");
  });

  it("keeps only the five most frequent failure lines", () => {
    const failures = Array.from({ length: 6 }, (_, index) => ({ line: `failure ${5 - index}`, count: 5 - index }));
    const text = renderAnalyticsReport(report({ failures }), "all history");
    expect(text).toContain("failure 5");
    expect(text).not.toContain("failure 0");
  });

  it("renders done-check, task-tool, and subagent measures", () => {
    const text = renderAnalyticsReport(
      report({
        doneChecks: [{ provider: "openai", model: "gpt-6-luna", thinking: "high", reports: 2, passes: 1 }],
        tasks: [{ provider: "openai", model: "gpt-6-luna", thinking: "high", runs: 1, calls: 4 }],
        subagents: [
          { agent: "reviewer", provider: "openai", model: "gpt-6-luna", thinking: "high", runs: 2, cost: 0.42 },
        ],
      }),
      "all history",
    );
    expect(text).toContain("MyPi features\nopenai/gpt-6-luna · high   2 done-check reports · 1 pass");
    expect(text).toContain("openai/gpt-6-luna · high   1 task-tool run · 4 calls");
    expect(text).toContain("reviewer · openai/gpt-6-luna · high   2 runs · $0.42 child cost");
  });

  it("renders permission dialogs per model and per rule", () => {
    const text = renderAnalyticsReport(
      report({
        approvals: [
          {
            provider: "openai",
            model: "gpt-6-luna",
            thinking: "high",
            dialogs: 4,
            yes: 2,
            no: 1,
            session: 1,
            noUi: 0,
          },
        ],
        approvalRules: [
          { rule: "plan-build", dialogs: 3, yes: 1, no: 1, session: 1, noUi: 0 },
          { rule: "folder-guard", dialogs: 1, yes: 1, no: 0, session: 0, noUi: 0 },
        ],
      }),
      "all history",
    );
    expect(text).toContain(
      "Permission dialogs\nopenai/gpt-6-luna · high   4 dialogs · yes 2 · no 1 · session 1 · no UI 0\n" +
        "  plan-build   3 dialogs · yes 1 · no 1 · session 1 · no UI 0\n" +
        "  folder-guard 1 dialog · yes 1 · no 0 · session 0 · no UI 0",
    );
  });

  it("reports how many other pi sessions were skipped", () => {
    expect(renderAnalyticsReport(report({ skippedSessions: 3 }), "all history")).toBe("3 other pi sessions skipped");
  });

  it("reports when nothing was recorded", () => {
    expect(renderAnalyticsReport(report({}), "all history")).toBe("No usage recorded for this period.");
  });
});
