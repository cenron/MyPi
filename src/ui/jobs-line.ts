import type { Theme } from "@earendil-works/pi-coding-agent";
import type { JobInfo } from "#core/types";
import { jobDuration } from "#tool/utils";

/** Most characters of a job's label on the line; the rest is in `/jobs`. */
const LABEL_CHARS = 24;

/**
 * The line below the editor while jobs run: how many, each one's label and time, and where to see more. Colors come
 * from `theme`, so the line follows the active theme. Undefined when nothing runs.
 */
export function jobsLine(jobs: readonly JobInfo[], theme: Pick<Theme, "fg">): string[] | undefined {
  if (!jobs.length) return undefined;

  const rows = jobs.map((job) => `${truncate(job.label, LABEL_CHARS)} ${jobDuration(job)}`);
  const count = theme.fg("accent", `${jobs.length} running`);
  return [`${count} · ${rows.join(" · ")} · ${theme.fg("dim", "/jobs")}`];
}

function truncate(label: string, maxLength: number): string {
  if (label.length <= maxLength) return label;
  return `${label.slice(0, maxLength - 1)}…`;
}
