import { stripVTControlCharacters } from "node:util";
import type { MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { JobInfo } from "#core/types";
import { expandKey, jobDuration, jobEnding } from "#tool/utils";

/** The custom message type of a job's exit notice. */
export const JOB_NOTICE = "mypi-job";

/** How many of a job's last lines a notice carries. */
export const NOTICE_LINES = 20;

/** Most characters of output a notice carries, so one huge line can't flood the context. */
const NOTICE_CHARS = 2000;

/** What a notice carries for its renderer: the job as it ended, and its last lines with escape codes stripped. */
export type NoticeDetails = { job: JobInfo; tail: string };

/**
 * The exit notice for a job that ended: the model's text (how it ended, how long it ran, the command, its last
 * lines, and the log file) and the details its renderer draws. `tail` is the job's last lines as written; escape
 * codes are stripped and it's cut to its last `NOTICE_CHARS` characters.
 */
export function jobNotice(job: JobInfo, tail: string): { content: string; details: NoticeDetails } {
  const output = stripVTControlCharacters(tail).slice(-NOTICE_CHARS);
  const lines = [`Background job ${job.id} ${jobEnding(job)} after ${jobDuration(job)}: ${job.label}`];
  if (job.error) lines.push(`Error: ${job.error}`);
  lines.push(output ? `Last lines:\n${output}` : "No output.", `Full output: ${job.logPath}`);
  return { content: lines.join("\n"), details: { job, tail: output } };
}

/**
 * Draws a notice: `job 1 completed · exit 0 · 3.0s · command` collapsed, in green or red, with its last lines when
 * expanded. Undefined without details, so pi falls back to its own drawing.
 */
export const renderNotice: MessageRenderer<NoticeDetails> = (message, { expanded, outputPad }, theme) => {
  if (!message.details) return undefined;
  return new Text(formatNotice(message.details, expanded, theme), outputPad, 0);
};

/** The notice's text for `renderNotice`. */
export function formatNotice({ job, tail }: NoticeDetails, expanded: boolean, theme: Theme): string {
  const color = job.status === "completed" ? "success" : "error";
  const facts = [job.exitCode === undefined ? undefined : `exit ${job.exitCode}`, jobDuration(job), job.label];
  const summary =
    theme.fg(color, `job ${job.id} ${job.status}`) + theme.fg("muted", ` · ${facts.filter(Boolean).join(" · ")}`);
  const head = job.error ? `${summary}\n${theme.fg("error", job.error)}` : summary;
  if (!tail) return head;
  if (!expanded) return `${head} ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
  return [head, ...tail.split("\n").map((line) => theme.fg("toolOutput", line))].join("\n");
}
