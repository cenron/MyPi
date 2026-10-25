import { lstat, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, isNodeError } from "#core/util/errors";
import { keepOutOfGit } from "#core/util/git";
import { isInside } from "#core/util/paths";
import { BRANCH_PREFIX, changedPaths, discover, git, validateName, type Worktree } from "./git";

/** Checkout removal can succeed while branch cleanup is refused; callers must show the reason. */
export type Removal = {
  readonly path: string;
  readonly branch: string;
  readonly branchDeleted: boolean;
  readonly reason?: string;
};

/** Cwd-bound, lazy shared service. Never moves the session or copies uncommitted/ignored source files. */
export class Worktrees {
  constructor(readonly cwd: string) {}

  async list(signal?: AbortSignal): Promise<Worktree[]> {
    return (await discover(this.cwd, signal)).entries;
  }

  /** Dirty callers are allowed: only their committed HEAD becomes the new checkout's base. */
  async create(name: string, signal?: AbortSignal): Promise<{ worktree: Worktree; baseCommit: string }> {
    validateName(name);
    const { main, entries } = await discover(this.cwd, signal);
    const baseCommit = (await git(this.cwd, ["rev-parse", "--verify", "HEAD^{commit}"], signal)).stdout.trim();
    const path = join(main, ".pi", "worktrees", name);
    const branch = `${BRANCH_PREFIX}${name}`;
    await checkStorage(main, name);
    if ((await statIfPresent(path)) || entries.some((entry) => entry.path === path || entry.branch === branch)) {
      throw new Error(
        `Worktree ${JSON.stringify(path)} already exists or is registered; choose another name or inspect it.`,
      );
    }
    if ((await git(this.cwd, ["show-ref", "--verify", "--quiet", branch], signal, 1)).code === 0) {
      throw new Error(`Branch ${branch} already exists; choose another name or inspect the branch.`);
    }
    const storage = join(main, ".pi", "worktrees");
    await mkdir(storage, { recursive: true });
    await checkStorage(main, name);
    await keepOutOfGit(storage);
    try {
      await git(
        this.cwd,
        ["worktree", "add", "--no-track", "-b", branch.slice("refs/heads/".length), path, baseCommit],
        signal,
      );
    } catch (error) {
      throw new Error(
        `Worktree creation failed: ${errorMessage(error)} Inspect path ${JSON.stringify(path)} and branch ${branch} for partial state. No automatic rollback was attempted.`,
        { cause: error },
      );
    }
    const worktree = (await this.list(signal)).find((entry) => entry.managedName === name);
    if (!worktree)
      throw new Error(
        `Created ${JSON.stringify(path)} but could not rediscover it; inspect Git worktrees before retrying.`,
      );
    return { worktree, baseCommit };
  }

  async remove(name: string, signal?: AbortSignal): Promise<Removal> {
    validateName(name);
    const { main, entries } = await discover(this.cwd, signal);
    await checkStorage(main, name);
    const entry = entries.find((entry) => entry.managedName === name);
    if (!entry?.branch)
      throw new Error(`No MyPi-managed worktree named ${name}; inspect the worktree list. Nothing was removed.`);
    if (entry.locked !== undefined || entry.prunable !== undefined) {
      throw new Error(`Worktree ${name} is locked or prunable; inspect its Git registration before removing it.`);
    }
    if (isInside(await realpath(entry.path), await realpath(this.cwd))) {
      throw new Error(
        `Cannot remove the worktree containing the calling cwd; leave ${JSON.stringify(entry.path)} first.`,
      );
    }
    await checkChanges(entry.path, signal);
    await git(main, ["worktree", "remove", entry.path], signal);
    const result = { path: entry.path, branch: entry.branch, branchDeleted: false };
    try {
      const ancestry = await git(main, ["merge-base", "--is-ancestor", entry.branch, "HEAD"], signal, 1);
      if (ancestry.code !== 0)
        return {
          ...result,
          reason:
            "Branch kept: its tip is not an ancestor of the main checkout's HEAD; integrate or inspect its commits.",
        };
      await git(main, ["branch", "-d", entry.branch.slice("refs/heads/".length)], signal);
      return { ...result, branchDeleted: true };
    } catch (error) {
      return {
        ...result,
        reason: `Checkout removed, branch kept: ${errorMessage(error)}`,
      };
    }
  }
}

async function statIfPresent(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Refuse links rather than resolving managed storage into an unrelated directory.
async function checkStorage(main: string, name: string): Promise<void> {
  for (const path of [join(main, ".pi"), join(main, ".pi", "worktrees"), join(main, ".pi", "worktrees", name)]) {
    if ((await statIfPresent(path))?.isSymbolicLink()) {
      throw new Error(
        `Symlinked worktree storage at ${JSON.stringify(path)}; replace it with a real directory before mutating worktrees.`,
      );
    }
  }
}

async function checkChanges(path: string, signal?: AbortSignal): Promise<void> {
  const status = await git(
    path,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"],
    signal,
  );
  // No ignore exclusions: Git patches omit these local memories/plans, so deleting them loses work.
  const localWork = await git(path, ["ls-files", "--others", "-z", "--", ".pi/memories/", ".pi/plans/"], signal);
  const protectedPaths = localWork.stdout
    .split("\0")
    .filter((file) => file && file !== ".pi/memories/.gitignore" && file !== ".pi/plans/.gitignore");
  const blockers = [...new Set([...changedPaths(status.stdout), ...protectedPaths])];
  if (blockers.length) {
    throw new Error(
      `Worktree has changes or protected local work:\n${blockers.map((file) => JSON.stringify(file)).join("\n")}\nCommit, integrate, or copy this work to safety before removal. Nothing was removed.`,
    );
  }
}
