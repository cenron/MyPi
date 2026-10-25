import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { createLocalBashOperations, getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorMessage, isNodeError } from "#core/util/errors";
import { isRecord } from "#core/util/guards";
import type { Project } from "#core/worktree/index";

/** Where a project lists its check commands, relative to its folder. */
export const COMMANDS_FILE = ".pi/done-check.json";

/** How long one command may run before it counts as failed. */
export const COMMAND_TIMEOUT_SECONDS = 120;

/** Most characters of a failed command's output the report keeps: the end, where the errors are. */
const OUTPUT_CHARS = 2_000;

/** A check command that didn't pass: how it ended, and the end of its output. */
export type CommandFailure = {
  command: string;
  ended: { kind: "exit"; code: number } | { kind: "timeout" } | { kind: "error"; message: string };
  output: string;
};

/**
 * The project's check commands from `COMMANDS_FILE`, or undefined when there's no file. Throws, saying what the file
 * should hold, when it isn't `{ "commands": [<string>, …] }`.
 */
export async function readCommands(cwd: string): Promise<string[] | undefined> {
  let text: string;
  try {
    text = await readFile(join(cwd, COMMANDS_FILE), "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }

  const commands = parseCommands(text);
  if (commands === undefined) {
    throw new Error(`${COMMANDS_FILE} must hold { "commands": ["npm test", …] }, a list of shell commands.`);
  }
  return commands;
}

/** Git checkouts share approval, but separate repositories and non-Git folders never inherit it. */
export async function approvalKey(project: Project | undefined, cwd: string): Promise<string> {
  return project ? `git:${project.commonDir}` : `folder:${await realpath(cwd)}`;
}

/** True when the user approved exactly `commands` for this repository/folder key. */
export async function isApproved(key: string, commands: readonly string[]): Promise<boolean> {
  const approved = (await readApprovals())[key];
  return approved !== undefined && sameList(approved, commands);
}

/**
 * Remembers that the user approved `commands` for this repository/folder key, on this machine only: in the done check's
 * own folder in pi's agent dir, never in the project, so a repo can't arrive approved.
 */
export async function approve(key: string, commands: readonly string[]): Promise<void> {
  const approvals = { ...(await readApprovals()), [key]: [...commands] };
  await mkdir(dirname(approvalsPath()), { recursive: true });
  await writeFile(approvalsPath(), `${JSON.stringify(approvals, null, 2)}\n`);
}

/**
 * Runs `command` in `cwd` through pi's own shell, as `bash` does, for at most `COMMAND_TIMEOUT_SECONDS`. Undefined
 * when it passes (exit code 0); otherwise how it failed. An abort (Esc) is thrown, so the check stops.
 */
export async function runCommand(
  command: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<CommandFailure | undefined> {
  let output = "";
  const onData = (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-OUTPUT_CHARS * 2);
  };
  const failure = (ended: CommandFailure["ended"]): CommandFailure => ({ command, ended, output: lastOutput(output) });

  try {
    const { exitCode } = await createLocalBashOperations().exec(command, cwd, {
      onData,
      signal,
      timeout: COMMAND_TIMEOUT_SECONDS,
    });
    // A null exit code is a failed command, as in pi's bash.
    return exitCode === 0 ? undefined : failure({ kind: "exit", code: exitCode ?? 1 });
  } catch (error) {
    if (signal?.aborted) throw error;
    // pi's exec throws `timeout:<seconds>` when the time ran out.
    if (errorMessage(error).startsWith("timeout:")) return failure({ kind: "timeout" });
    return failure({ kind: "error", message: errorMessage(error) });
  }
}

/** The approved lists, by repository/folder key. A missing or unreadable file means none; entries that aren't lists are dropped. */
async function readApprovals(): Promise<Record<string, string[]>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(approvalsPath(), "utf8"));
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};

  const approvals: Record<string, string[]> = {};
  for (const [cwd, commands] of Object.entries(parsed)) {
    if (isStringList(commands)) approvals[cwd] = commands;
  }
  return approvals;
}

function approvalsPath(): string {
  return join(getAgentDir(), "done-check", "approved.json");
}

/** The commands in a `COMMANDS_FILE`'s text, or undefined when it isn't `{ "commands": [<string>, …] }`. */
function parseCommands(text: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && isStringList(parsed.commands) ? parsed.commands : undefined;
  } catch {
    return undefined;
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** The end of a command's output, without escape codes, at most `OUTPUT_CHARS` characters. */
function lastOutput(output: string): string {
  return stripVTControlCharacters(output).trim().slice(-OUTPUT_CHARS);
}
