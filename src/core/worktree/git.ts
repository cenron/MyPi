import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { errorMessage } from "#core/util/errors";

const execute = promisify(execFile);
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;
const WORKTREE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const BRANCH_PREFIX = "refs/heads/mypi/worktree/";

/** Git is authoritative; managedName is present only for an exact non-primary path/branch pair. */
export type Worktree = {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly bare: boolean;
  readonly locked?: string;
  readonly prunable?: string;
  readonly primary: boolean;
  readonly managedName?: string;
};

/** Reject names before any filesystem mutation or option construction. */
export function validateName(name: string): void {
  if (!WORKTREE_NAME.test(name)) {
    throw new Error(
      "Worktree name must be 1–64 lowercase letters, digits, or hyphens, starting with a letter or digit.",
    );
  }
}

/** NUL records preserve whitespace in paths and optional flag reasons, unlike line splitting. */
export function parseWorktrees(output: string): Worktree[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record, index) => {
      const fields = new Map(
        record
          .split("\0")
          .filter(Boolean)
          .map((field) => {
            const space = field.indexOf(" ");
            return space < 0 ? [field, ""] : [field.slice(0, space), field.slice(space + 1)];
          }),
      );
      const path = fields.get("worktree");
      if (!path) throw new Error("Invalid Git worktree record: missing path; inspect git worktree list.");
      return {
        path,
        head: fields.get("HEAD"),
        branch: fields.get("branch"),
        detached: fields.has("detached"),
        bare: fields.has("bare"),
        locked: fields.get("locked"),
        prunable: fields.get("prunable"),
        primary: index === 0,
      };
    });
}

/** A path alone never grants ownership of a checkout. */
export function managedName(entry: Worktree, main: string): string | undefined {
  if (entry.primary || entry.detached || entry.bare || !entry.branch?.startsWith(BRANCH_PREFIX)) return undefined;
  const name = entry.branch.slice(BRANCH_PREFIX.length);
  if (!WORKTREE_NAME.test(name)) return undefined;
  return entry.path === join(main, ".pi", "worktrees", name) ? name : undefined;
}

/** Bounded output fails rather than silently truncating. Only explicitly expected exit codes are returned. */
export async function git(cwd: string, args: string[], signal?: AbortSignal, expectedCode?: number) {
  try {
    const result = await execute("git", args, { cwd, signal, maxBuffer: MAX_GIT_OUTPUT, encoding: "utf8" });
    return { stdout: result.stdout, code: 0 };
  } catch (error) {
    if (
      expectedCode !== undefined &&
      error instanceof Error &&
      "code" in error &&
      error.code === expectedCode &&
      "stdout" in error &&
      typeof error.stdout === "string"
    ) {
      return { stdout: error.stdout, code: expectedCode };
    }
    throw new Error(
      `Git ${args.join(" ")} failed in ${JSON.stringify(cwd)}: ${errorMessage(error)}. Inspect the repository before retrying.`,
      { cause: error },
    );
  }
}

/** Discovery does no writes; bare-primary layouts are deliberately unsupported. */
export async function discover(cwd: string, signal?: AbortSignal) {
  const entries = parseWorktrees((await git(cwd, ["worktree", "list", "--porcelain", "-z"], signal)).stdout);
  const primary = entries[0];
  if (!primary || primary.bare)
    throw new Error("Worktrees require a non-bare primary checkout; use a regular Git checkout.");
  const main = await realpath(primary.path);
  return { main, entries: entries.map((entry) => ({ ...entry, managedName: managedName(entry, main) })) };
}

/** Status rename records have a second NUL-delimited path; show both, without unquoting filenames. */
export function changedPaths(output: string): string[] {
  const fields = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;
    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2))) {
      const source = fields[++index];
      if (source) paths.push(source);
    }
  }
  return paths;
}
