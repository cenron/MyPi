import { isAbsolute, relative } from "node:path";
import type { Problem } from "#core/events";
import { type FileChange, FileChangeKind } from "#core/util/walk";

/** Most changed files one check asks about; a large `git checkout` shouldn't open hundreds of files in a server. */
export const MAX_CHECKED_FILES = 50;

/** Most errors one report lists; the agent fixes the first ones, and the next round shows the rest. */
const MAX_REPORTED_ERRORS = 20;

/** The files a run changed that are still there to check, at most `MAX_CHECKED_FILES`, and how many were left out. */
export function filesToCheck(changes: readonly FileChange[]): { files: string[]; skipped: number } {
  const present = changes.filter((change) => change.kind !== FileChangeKind.DELETED).map((change) => change.file);
  return { files: present.slice(0, MAX_CHECKED_FILES), skipped: Math.max(0, present.length - MAX_CHECKED_FILES) };
}

/**
 * The report the agent gets: the errors in the files it changed, by file and line, and what to do about them.
 * Undefined when there are none, so the check stays quiet. Warnings and hints never count.
 */
export function errorsReport(problems: readonly Problem[], cwd: string, skipped = 0): string | undefined {
  const errors = problems
    .filter((problem) => problem.severity === "error")
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  if (errors.length === 0) return undefined;

  const shown = errors.slice(0, MAX_REPORTED_ERRORS).map((error) => errorLine(error, cwd));
  const hidden = errors.length - shown.length;
  return [
    `Done check: ${errors.length === 1 ? "1 error" : `${errors.length} errors`} in files changed during this run.`,
    ...shown,
    ...(hidden > 0 ? [`… and ${hidden} more.`] : []),
    ...(skipped > 0 ? [`${skipped} more changed files weren't checked.`] : []),
    "Fix these, or say why they're fine.",
  ].join("\n");
}

/** `src/store.ts:12:7  Type 'string' is not assignable to type 'number'. (ts 2322)` */
function errorLine({ file, line, column, message, origin }: Problem, cwd: string): string {
  const path = relative(cwd, file);
  const where = path.startsWith("..") || isAbsolute(path) ? file : path;
  return `${where}:${line}:${column}  ${message.replaceAll("\n", "\n    ")}${origin ? ` (${origin})` : ""}`;
}
