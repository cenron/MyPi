import { isAbsolute, relative } from "node:path";
import type { Problem } from "#core/channels";
import { type FileChange, FileChangeKind } from "#core/util/walk";
import { COMMAND_TIMEOUT_SECONDS, type CommandFailure } from "./project-commands";

/** Most changed files one check asks about; a large `git checkout` shouldn't open hundreds of files in a server. */
export const MAX_CHECKED_FILES = 50;

/** Most errors one report lists; the agent fixes the first ones, and the next round shows the rest. */
const MAX_REPORTED_ERRORS = 20;

/** What one check found: the sources' problems and the commands that failed, and how many changed files it left out. */
export type Findings = { problems: readonly Problem[]; failures: readonly CommandFailure[]; skipped: number };

/**
 * The line the agent gets when a check found nothing, naming what ran so a pass isn't mistaken for no check. Undefined
 * when nothing ran: no source checked the `files` changed files and no command is approved.
 */
export function doneCheckPassed(
  sources: readonly string[],
  commands: readonly string[],
  files: number,
): string | undefined {
  if (sources.length === 0 && commands.length === 0) return undefined;

  const parts = [
    ...(sources.length > 0
      ? [`${sources.join(", ")} checked ${files === 1 ? "1 changed file" : `${files} changed files`}`]
      : []),
    ...commands.map((command) => `${command} passed`),
  ];
  return `Done check passed: ${parts.join("; ")}.`;
}

/** The files a run changed that are still there to check, at most `MAX_CHECKED_FILES`, and how many were left out. */
export function filesToCheck(changes: readonly FileChange[]): { files: string[]; skipped: number } {
  const present = changes.filter((change) => change.kind !== FileChangeKind.DELETED).map((change) => change.file);
  return { files: present.slice(0, MAX_CHECKED_FILES), skipped: Math.max(0, present.length - MAX_CHECKED_FILES) };
}

/**
 * The report the agent gets: the errors in the files the run changed, by file and line, then each check command that
 * failed with the end of its output, and what to do about them. Undefined when there are none, so the check stays
 * quiet. Warnings and hints never count.
 */
export function doneCheckReport({ problems, failures, skipped }: Findings, cwd: string): string | undefined {
  const errors = problems
    .filter((problem) => problem.severity === "error")
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  if (errors.length === 0 && failures.length === 0) return undefined;

  const shown = errors.slice(0, MAX_REPORTED_ERRORS).map((error) => errorLine(error, cwd));
  const hidden = errors.length - shown.length;
  return [
    `Done check: ${summary(errors.length, failures.length)}.`,
    ...shown,
    ...(hidden > 0 ? [`… and ${hidden} more.`] : []),
    ...(errors.length > 0 && skipped > 0 ? [`${skipped} more changed files weren't checked.`] : []),
    ...failures.map(failureBlock),
    "Fix these, or say why they're fine.",
  ].join("\n");
}

/** `2 errors in files changed during this run, and 1 check command failed`, with only the parts there are. */
function summary(errors: number, failures: number): string {
  const parts = [
    ...(errors > 0 ? [`${errors === 1 ? "1 error" : `${errors} errors`} in files changed during this run`] : []),
    ...(failures > 0 ? [`${failures === 1 ? "1 check command" : `${failures} check commands`} failed`] : []),
  ];
  return parts.join(", and ");
}

/** `` `npm test` failed (exit 1): `` and the end of its output, indented under it. */
function failureBlock({ command, ended, output }: CommandFailure): string {
  const how =
    ended.kind === "exit"
      ? `exit ${ended.code}`
      : ended.kind === "timeout"
        ? `timed out after ${COMMAND_TIMEOUT_SECONDS}s`
        : `couldn't run: ${ended.message}`;
  const lines = output ? `\n${output.replace(/^/gm, "    ")}` : "";
  return `\`${command}\` failed (${how}):${lines}`;
}

/** `src/store.ts:12:7  Type 'string' is not assignable to type 'number'. (ts 2322)` */
function errorLine({ file, line, column, message, origin }: Problem, cwd: string): string {
  const path = relative(cwd, file);
  const where = path.startsWith("..") || isAbsolute(path) ? file : path;
  return `${where}:${line}:${column}  ${message.replaceAll("\n", "\n    ")}${origin ? ` (${origin})` : ""}`;
}
