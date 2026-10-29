import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { errorMessage } from "#core/util/errors";
import type { ReportOptions } from "../report";

const parameters = Type.Object({
  period: Type.Optional(
    Type.Union([Type.Literal("7d"), Type.Literal("all")], {
      description: 'Report period: "7d" (default) or "all" history.',
    }),
  ),
  project: Type.Optional(
    Type.String({
      description:
        "Only sessions whose folder path contains this text, such as a project folder name; leave it out for all projects.",
    }),
  ),
});

type AnalyticsArgs = Static<typeof parameters>;

/** Returns the local analytics report for the period and project requested by the model. */
export function analyticsTool(report: (options: ReportOptions) => Promise<string>) {
  return defineTool({
    name: "analytics",
    label: "Analytics",
    description:
      "Use this when the user asks how MyPi or the agent is doing, what the analytics or metrics say, what a model or " +
      "session cost, which tools fail, or how MyPi features are used. For a general ‘how are you doing / how are you " +
      "looking / how’s it going’ question, call this without asking and answer with a short summary and insights: lead " +
      "with the report window and how much history it holds (its first line names both); note what stands out (biggest cost, often-failing tools, " +
      "or a feature shown as unused), compare with dated Findings as past numbers and name their dates, and suggest " +
      "what to investigate next. Treat a feature missing from the report as unknown, not unused. Use numbers only from " +
      "the report, never present a Findings number as current. It returns the same local report as " +
      "`/analytics`: model usage and cost, tool calls and failures, shell commands, code navigation, MyPi features, and " +
      "permission dialogs, for the last 7 days or all history, for one project or all. The Findings in " +
      "`docs/modules/analytics.md` are dated decisions from past windows, not current numbers; use this report for " +
      "“what does it say now?”.",
    promptSnippet:
      "Read the current local analytics report, for the last 7 days or all history, for one project or all",
    parameters,
    annotations: { readOnlyHint: true },
    async execute(_id, args: AnalyticsArgs) {
      try {
        return {
          content: [{ type: "text", text: await report({ all: args.period === "all", project: args.project }) }],
          details: undefined,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Analytics indexing failed: ${errorMessage(error)}.` }],
          details: undefined,
          isError: true,
        };
      }
    },
  });
}
