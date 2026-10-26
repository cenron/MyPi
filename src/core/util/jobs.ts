import type { JobInfo } from "#core/types";

/**
 * How a job ended, or `running`: `completed (exit code 0)`, `failed (exit code 3)`, `failed` (it threw), or `stopped`.
 *
 * @example
 * `Background job ${job.id} ${jobEnding(job)} after ${jobDuration(job)}: ${job.label}`
 * // "Background job 1 completed (exit code 0) after 3.0s: npm test"
 */
export function jobEnding({ status, exitCode }: JobInfo): string {
  return exitCode === undefined ? status : `${status} (exit code ${exitCode})`;
}

/**
 * How long a job ran, or has run so far while it's running, in seconds with one decimal, such as `3.0s`.
 *
 * @example
 * `${job.id} · ${jobEnding(job)} · ${jobDuration(job)}` // "2 · running · 12.4s"
 */
export function jobDuration({ startedAt, endedAt }: JobInfo): string {
  return `${(((endedAt ?? Date.now()) - startedAt) / 1000).toFixed(1)}s`;
}
