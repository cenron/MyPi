import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { expandKey, textOf } from "#ui/render";

/** Most characters of the task a job's label and a call's line show: models write a whole paragraph on one line. */
const LABEL_TASK_CHARS = 60;

/** Most of the child's steps a foreground call shows while it runs, until expanded. */
const PROGRESS_LINES = 5;

/** Most characters of a foreground answer shown until expanded. */
const PREVIEW_CHARS = 500;

/** The call line: `subagent <agent>` and the start of the task; either may be missing while the call is written. */
export function callText(args: { agent?: string; task?: string }, theme: Theme): string {
  const title = theme.fg("toolTitle", theme.bold(`subagent ${args.agent ?? "..."}`));
  return `${title} ${theme.fg("muted", taskStart(args.task ?? "..."))}`;
}

/** Below the call: the job it started, a foreground run's steps while it runs, or its answer once it ends. */
export function resultText(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  isPartial: boolean,
  theme: Theme,
): string {
  const details = result.details as { jobId?: string; steps?: string[] } | undefined;
  if (!isPartial && details?.jobId) return `\n${theme.fg("muted", `started as job ${details.jobId}`)}`;
  if (details?.steps) return formatProgress(details.steps, expanded, theme);
  return formatOutput(textOf(result.content), expanded, theme);
}

/** The start of the task's first line, at most `LABEL_TASK_CHARS` characters. */
export function taskStart(task: string): string {
  const line = task.split("\n", 1)[0] ?? "";
  return line.length > LABEL_TASK_CHARS ? `${line.slice(0, LABEL_TASK_CHARS - 1)}…` : line;
}

/** A running foreground call's steps: the last few, or all of them when expanded. */
function formatProgress(steps: string[], expanded: boolean, theme: Theme): string {
  const visible = expanded ? steps : steps.slice(-PROGRESS_LINES);
  const lines = visible.map((step) => `  ${step}`).join("\n");
  if (expanded || steps.length <= PROGRESS_LINES) return `\n${lines}`;

  const hint = theme.fg("dim", `(${expandKey()} to expand)`);
  return `\n… ${steps.length - PROGRESS_LINES} earlier steps\n${lines} ${hint}`;
}

/** A finished foreground call's text: its start, or all of it when expanded. */
function formatOutput(output: string, expanded: boolean, theme: Theme): string {
  if (expanded || output.length <= PREVIEW_CHARS) return `\n${output}`;
  return `\n${output.slice(0, PREVIEW_CHARS)}… ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
}
