import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const MAX_GIT_OUTPUT = 16 * 1024 * 1024;
const WORKTREE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const BRANCH_PREFIX = "mypi/worktree/";
const HEADS = "refs/heads/";

/** A checkout from `git worktree list`; `managedName` is set only for MyPi's own, at its exact path and branch. */
export type Worktree = {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly primary: boolean;
  readonly managedName?: string;
};

/** Checked before the name reaches a path or a git argument. */
export function validateName(name: string): void {
  if (!WORKTREE_NAME.test(name)) {
    throw new Error(
      "Worktree name must be 1–64 lowercase letters, digits, or hyphens, starting with a letter or digit.",
    );
  }
}

/** Runs git without a shell; `LC_ALL=C` keeps its messages in English. */
export async function gitOutput(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execute("git", args, {
    cwd,
    maxBuffer: MAX_GIT_OUTPUT,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  });
}

/** Runs git without a shell and returns stdout; a failure throws with git's own message. */
export async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitOutput(cwd, args)).stdout;
}

/** The main checkout (git lists it first) and every worktree of the repository `cwd` is in. */
export async function mainAndWorktrees(cwd: string): Promise<{ main: string; entries: Worktree[] }> {
  const entries = parseWorktrees(await git(cwd, ["worktree", "list", "--porcelain", "-z"]));
  const main = await realpath(entries[0]?.path ?? cwd);

  return { main, entries: entries.map((entry) => ({ ...entry, managedName: managedName(entry, main) })) };
}

/** `git worktree list --porcelain -z`: records end in two NULs and fields in one, so paths keep their spaces. */
export function parseWorktrees(output: string): Worktree[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record, index) => {
      const fields = new Map(record.split("\0").map(splitField));
      return {
        path: fields.get("worktree") ?? "",
        head: fields.get("HEAD"),
        branch: fields.get("branch"),
        primary: index === 0,
      };
    });
}

/** The paths in `git status --porcelain=v1 -z` output; a rename or copy also names its source. */
export function changedPaths(output: string): string[] {
  const fields = output.split("\0");
  const paths: string[] = [];

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;

    paths.push(field.slice(3));
    if (/[RC]/.test(field.slice(0, 2))) paths.push(fields[++index] ?? "");
  }
  return paths.filter(Boolean);
}

/** A path alone never makes a checkout MyPi's: the branch must match too. */
function managedName(entry: Worktree, main: string): string | undefined {
  const prefix = `${HEADS}${BRANCH_PREFIX}`;
  if (entry.primary || !entry.branch?.startsWith(prefix)) return undefined;

  const name = entry.branch.slice(prefix.length);
  return entry.path === join(main, ".pi", "worktrees", name) ? name : undefined;
}

function splitField(field: string): [string, string] {
  const space = field.indexOf(" ");
  return space < 0 ? [field, ""] : [field.slice(0, space), field.slice(space + 1)];
}
