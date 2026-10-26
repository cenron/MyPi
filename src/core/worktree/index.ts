import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "#core/util/errors";
import { keepOutOfGit } from "#core/util/git";
import { isInside } from "#core/util/paths";
import { BRANCH_PREFIX, changedPaths, git, mainAndWorktrees, validateName, type Worktree } from "./git";

/** The repository a session is in: its main checkout, and git's shared folder, which names the repository. */
export type Project = { readonly main: string; readonly commonDir: string };

/** A managed worktree, and the files that would stop `remove`. */
export type Inspection = { readonly worktree: Worktree; readonly blockers: string[] };

/** What `remove` did. The checkout is gone; its branch only when it was merged. */
export type Removal = {
  readonly path: string;
  readonly branch: string;
  readonly branchDeleted: boolean;
  readonly reason?: string;
};

/** The ignore files `keepOutOfGit` writes: housekeeping, not work. */
const IGNORE_MARKERS = new Set([".pi/memories/.gitignore", ".pi/plans/.gitignore"]);

/**
 * The git worktrees of the repository `cwd` is in, for the `/worktree` command and subagents. Does nothing until
 * called, and never moves a session. Git does the checking: an existing branch or path, or a locked worktree, fails
 * with git's own message.
 */
export class Worktrees {
  constructor(readonly cwd: string) {}

  /** The repository, or undefined outside git. Any other git failure throws. */
  async project(): Promise<Project | undefined> {
    let commonDir: string;
    try {
      commonDir = (await git(this.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    } catch (error) {
      if (errorMessage(error).includes("not a git repository")) return undefined;
      throw error;
    }

    const { main } = await mainAndWorktrees(this.cwd);
    return { main, commonDir: await realpath(commonDir) };
  }

  async list(): Promise<Worktree[]> {
    return (await mainAndWorktrees(this.cwd)).entries;
  }

  /** A new checkout at `<main>/.pi/worktrees/<name>` on a new branch, from the calling checkout's committed HEAD. */
  async create(name: string): Promise<Worktree> {
    validateName(name);

    const { main } = await mainAndWorktrees(this.cwd);
    const storage = join(main, ".pi", "worktrees");
    await mkdir(storage, { recursive: true });
    // Keeps git, Biome, and rg off the checkouts inside the main one.
    await keepOutOfGit(storage);

    const branch = `${BRANCH_PREFIX}${name}`;
    await git(this.cwd, ["worktree", "add", "--no-track", "-b", branch, join(storage, name), "HEAD"]);
    return (await this.inspect(name)).worktree;
  }

  /** Worktree `name`, which must be MyPi's, with its blockers. Changes don't stop entering or keeping it. */
  async inspect(name: string): Promise<Inspection> {
    validateName(name);

    const worktree = (await this.list()).find((entry) => entry.managedName === name);
    if (!worktree) throw new Error(`No MyPi worktree named ${name}; /worktree list shows them.`);

    return { worktree, blockers: await blockers(worktree.path) };
  }

  /** Discards a managed worktree and its branch after its work has been saved elsewhere. */
  async discard(name: string): Promise<void> {
    const { worktree, blockers } = await this.inspect(name);
    if (isInside(worktree.path, await realpath(this.cwd))) {
      throw new Error(`Leave worktree ${name} before discarding it.`);
    }
    const localBlockers = blockers.filter((file) => file.startsWith(".pi/memories/") || file.startsWith(".pi/plans/"));
    if (localBlockers.length) {
      throw new Error(`Worktree ${name} has local state that cannot be discarded:\n${localBlockers.join("\n")}`);
    }

    const { main } = await mainAndWorktrees(this.cwd);
    await git(main, ["worktree", "remove", "--force", worktree.path]);
    await git(main, ["branch", "-D", `${BRANCH_PREFIX}${name}`]);
  }

  /** Removes a clean managed worktree, and its branch when merged into the main checkout's HEAD. Never forces. */
  async remove(name: string): Promise<Removal> {
    const { worktree, blockers } = await this.inspect(name);
    if (isInside(worktree.path, await realpath(this.cwd))) {
      throw new Error(`Leave worktree ${name} before removing it.`);
    }
    if (blockers.length) {
      throw new Error(`Worktree ${name} has work that would be lost; commit or move it first:\n${blockers.join("\n")}`);
    }

    const { main } = await mainAndWorktrees(this.cwd);
    await git(main, ["worktree", "remove", worktree.path]);

    const branch = `${BRANCH_PREFIX}${name}`;
    try {
      await git(main, ["branch", "-d", branch]);
      return { path: worktree.path, branch, branchDeleted: true };
    } catch (error) {
      return { path: worktree.path, branch, branchDeleted: false, reason: `Branch kept: ${errorMessage(error)}` };
    }
  }
}

/**
 * Changed and untracked files, plus new files in `.pi/memories/` and `.pi/plans/` even though they're ignored: a patch
 * from `git diff` can't carry them, so removing the checkout would lose them. Other ignored files don't count.
 */
async function blockers(path: string): Promise<string[]> {
  const status = await git(path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const local = await git(path, ["ls-files", "--others", "-z", "--", ".pi/memories/", ".pi/plans/"]);
  const localWork = local.split("\0").filter((file) => file && !IGNORE_MARKERS.has(file));

  return [...new Set([...changedPaths(status), ...localWork])];
}
