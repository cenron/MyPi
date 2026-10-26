import { stripVTControlCharacters } from "node:util";
import type { MessageRenderer, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { Session } from "#core/session";
import type { Job, JobInfo } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { expandKey, jobDuration, jobEnding } from "#tool/utils";

/** The custom message type of a job's exit notice. */
export const JOB_NOTICE = "mypi-job";

/** How many of a job's last lines a notice carries. */
export const NOTICE_LINES = 20;

/** A notice builder and whether its text has already been returned to the model. */
type NoticeEntry = { build: (ended: JobInfo) => JobNotice; taken: boolean };
const notices = new WeakMap<Job, NoticeEntry>();

/**
 * Delays successful job notices to combine nearby completions. Jobs without a notice taken before flush are sent
 * together in one follow-up.
 */
export class NoticeGroup {
  private readonly jobs = new Set<Job>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly session: Session,
    private readonly waitMs: number,
  ) {}

  add(job: Job): void {
    this.jobs.add(job);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.waitMs);
  }

  private flush(): void {
    this.timer = undefined;
    const jobs = [...this.jobs];
    this.jobs.clear();
    if (this.session.jobs.closed) return;

    const content = jobs
      .filter((job) => !notices.get(job)?.taken)
      .map((job) => takeNotice(job).content)
      .join("\n\n");
    if (!content) return;

    this.session.pi.sendMessage(
      { customType: JOB_NOTICE, display: true, content, details: undefined },
      { deliverAs: "followUp", triggerTurn: true },
    );
  }
}

/**
 * Tells the model when `job` ends, starting a turn if the agent is idle. `notice` builds the message; by default it
 * carries the job's last lines. Successful jobs may join a group; failures are sent at once.
 */
export function noticeOnEnd(
  session: Session,
  job: Job,
  notice: (ended: JobInfo) => JobNotice = (ended) => jobNotice(ended, job.tail(NOTICE_LINES)),
  group?: NoticeGroup,
): void {
  notices.set(job, { build: notice, taken: false });
  job.done
    .then((ended) => {
      const entry = notices.get(job);
      if (session.jobs.closed || ended.status === "stopped" || entry?.taken) return;
      if (group && ended.status === "completed") {
        group.add(job);
        return;
      }
      session.pi.sendMessage(
        { customType: JOB_NOTICE, display: true, ...notice(ended) },
        { deliverAs: "followUp", triggerTurn: true },
      );
    })
    .catch((error) => session.logError(`Job ${job.info.id} notice: ${errorMessage(error)}`));
}

/** Reserves a notice while `job_wait` waits, preventing completion from racing its returned result. */
export function reserveNotice(job: Job): void {
  const entry = notices.get(job);
  if (entry) entry.taken = true;
}

/** Releases a reserved notice when a wait ends before the job, so its later completion is still delivered. */
export function releaseNotice(job: Job): void {
  const entry = notices.get(job);
  if (entry) entry.taken = false;
}

/** Builds and marks a job's notice as consumed, so a later completion cannot deliver it again. */
export function takeNotice(job: Job): JobNotice {
  const ended = job.info;
  const entry = notices.get(job);
  if (entry) entry.taken = true;
  return (entry?.build ?? ((info) => jobNotice(info, job.tail(NOTICE_LINES))))(ended);
}

/** Most characters of output a notice carries, so one huge line can't flood the context. */
const NOTICE_CHARS = 2000;

/** What a notice carries for its renderer: the job as it ended, and its last lines with escape codes stripped. */
export type NoticeDetails = { job: JobInfo; tail: string };

/** A job notice: the model's text and what its renderer draws. */
export type JobNotice = { content: string; details: NoticeDetails };

/**
 * The exit notice for a job that ended: the model's text (how it ended, how long it ran, the command, its last
 * lines, and the log file) and the details its renderer draws. `tail` is the job's last lines as written; escape
 * codes are stripped and it's cut to its last `NOTICE_CHARS` characters.
 */
export function jobNotice(job: JobInfo, tail: string): JobNotice {
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
