import { isAbsolute, relative, sep } from "node:path";
import type { Duplicate, OpenTask, Problem } from "#core/channels";
import { type FileChange, FileChangeKind } from "#core/util/walk";
import { MAX_REPORTED_DUPLICATES } from "./duplicates";
import { COMMAND_TIMEOUT_SECONDS, type CommandFailure } from "./project-commands";

/** Most changed files one check asks about; a large `git checkout` shouldn't open hundreds of files in a server. */
export const MAX_CHECKED_FILES = 50;

/** Most errors one report lists; the agent fixes the first ones, and the next round shows the rest. */
const MAX_REPORTED_ERRORS = 20;

/** What to do about duplicated names. */
const DUPLICATES_NEXT_STEP = "Reuse the existing one, or say why a second one is right.";

/**
 * What to do about open tasks. The last sentence keeps the report from overriding the user: seen live, a model told
 * "do only the first, then stop" was sent back and did the second too.
 */
const OPEN_TASKS_NEXT_STEP =
  "Finish these tasks, or mark each completed or deleted and say why. If the user asked you to stop before them, leave them open and say so.";

/** What one check found: source problems, failed commands, skipped files, and tasks that are still open. */
export type Findings = {
  problems: readonly Problem[];
  failures: readonly CommandFailure[];
  skipped: number;
  openTasks?: readonly OpenTask[];
  duplicates?: readonly Duplicate[];
};

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

/** Changed files Git doesn't ignore; directory entries from `git ls-files --directory` end in `/`. */
export function changesNotIgnored(
  changes: readonly FileChange[],
  ignored: readonly string[],
  cwd: string,
): FileChange[] {
  return changes.filter((change) => {
    const path = relative(cwd, change.file).split(sep).join("/");
    return !ignored.some((entry) => {
      const ignoredPath = entry.endsWith("/") ? entry.slice(0, -1) : entry;
      return path === ignoredPath || path.startsWith(`${ignoredPath}/`);
    });
  });
}

/** The files a run changed that are still there to check, at most `MAX_CHECKED_FILES`, and how many were left out. */
export function filesToCheck(changes: readonly FileChange[]): { files: string[]; skipped: number } {
  const present = changes.filter((change) => change.kind !== FileChangeKind.DELETED).map((change) => change.file);
  return { files: present.slice(0, MAX_CHECKED_FILES), skipped: Math.max(0, present.length - MAX_CHECKED_FILES) };
}

/**
 * The report the agent gets: changed-file errors, failed commands, and open tasks, with a next step for each. Undefined
 * when there is nothing to report, so the check stays quiet. Warnings and hints never count.
 */
export function doneCheckReport(
  { problems, failures, skipped, openTasks = [], duplicates = [] }: Findings,
  cwd: string,
): string | undefined {
  const errors = problems
    .filter((problem) => problem.severity === "error")
    .toSorted((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  if (errors.length === 0 && failures.length === 0 && openTasks.length === 0 && duplicates.length === 0)
    return undefined;

  const shown = errors.slice(0, MAX_REPORTED_ERRORS).map((error) => errorLine(error, cwd));
  const hidden = errors.length - shown.length;
  const findingsSummary = summary(errors.length, failures.length);
  return [
    // Always the first words: a compaction summary sees this report as a user message, so it must say who wrote it.
    findingsSummary ? `Done check: ${findingsSummary}.` : "Done check:",
    ...shown,
    ...(hidden > 0 ? [`… and ${hidden} more.`] : []),
    ...(errors.length > 0 && skipped > 0 ? [`${skipped} more changed files weren't checked.`] : []),
    ...failures.map(failureBlock),
    ...(openTasks.length > 0 ? [openTasksBlock(openTasks)] : []),
    ...(duplicates.length > 0 ? [duplicatesBlock(duplicates, cwd)] : []),
    ...(errors.length > 0 || failures.length > 0 ? ["Fix these, or say why they're fine."] : []),
    ...(duplicates.length > 0 ? [DUPLICATES_NEXT_STEP] : []),
    ...(openTasks.length > 0 ? [OPEN_TASKS_NEXT_STEP] : []),
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

/** The pending work that keeps a Build run from passing. */
function duplicatesBlock(duplicates: readonly Duplicate[], cwd: string): string {
  const shown = duplicates.slice(0, MAX_REPORTED_DUPLICATES);
  const lines = shown.map(
    ({ name, file, line, elsewhere }) =>
      `\`${name}\` (${relative(cwd, file)}:${line}) is also in ${relative(cwd, elsewhere.file)}:${elsewhere.line}`,
  );
  const hidden = duplicates.length - shown.length;
  return `${duplicates.length} new ${duplicates.length === 1 ? "name" : "names"} already ${duplicates.length === 1 ? "exists" : "exist"} elsewhere:\n${[
    ...lines,
    ...(hidden > 0 ? [`… and ${hidden} more.`] : []),
  ].join("\n")}`;
}

function openTasksBlock(tasks: readonly OpenTask[]): string {
  const lines = tasks.map(({ id, subject, status }) => `#${id} [${status}] ${subject.replace(/[\r\n]+/g, " ")}`);
  return `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} still open:\n${lines.join("\n")}`;
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
