import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Session } from "#core/session";
import { keepOutOfGit } from "#core/util/git";
import { slugify } from "#core/util/slug";
import { git } from "#core/worktree/git";
import type { AgentDefinition } from "./agents";

/** A writer's isolated checkout and the commit its patch must include changes from. */
export type PreparedWriter = {
  readonly name: string;
  readonly base: string;
  readonly path: string;
  readonly main: string;
};

/** Saved patch details for a writer with changes; no-change runs have no handoff files. */
export type CapturedWork = {
  readonly name: string;
  readonly files: string[];
  readonly patchPath?: string;
  readonly handoffPath?: string;
  readonly diffStat?: string;
};

/** Where patches and handoffs wait, under the main checkout; kept out of git. */
export const PATCHES_DIR = join(".pi", "patches");

/** Longest agent-name part of a worktree name, leaving room for `sub-` and the number. */
const MAX_SLUG_CHARS = 40;

/**
 * Creates the writer's private worktree at the caller's committed HEAD. Refuses outside a git project, and when the
 * checkout has uncommitted changes the writer wouldn't see.
 */
export async function prepareWriter(session: Session, agent: AgentDefinition): Promise<PreparedWriter> {
  const project = session.project;
  if (!project) throw new Error("A worktree writer needs a git project.");

  const status = await git(session.ctx.cwd, ["status", "--porcelain"]);
  if (status) {
    throw new Error(`Cannot start ${agent.name} in a worktree while this checkout has uncommitted changes:\n${status}`);
  }

  const name = await freeName(session, project.main, agent.name);
  const base = (await git(session.ctx.cwd, ["rev-parse", "HEAD"])).trim();
  const worktree = await session.worktrees.create(name);
  return { name, base, path: worktree.path, main: project.main };
}

/** Saves all work since `base`, including the writer's own commits, before discarding its checkout. */
export async function captureWork(
  session: Session,
  prepared: PreparedWriter,
  agent: AgentDefinition,
  task: string,
  answer: string,
): Promise<CapturedWork> {
  await git(prepared.path, ["add", "-A"]);
  const patch = await git(prepared.path, ["diff", "--cached", "--binary", prepared.base]);
  const diffStat = await git(prepared.path, ["diff", "--cached", "--stat", prepared.base]);
  const files = (await git(prepared.path, ["diff", "--cached", "--name-only", "-z", prepared.base]))
    .split("\0")
    .filter(Boolean);

  if (!files.length) {
    await session.worktrees.discard(prepared.name);
    return { name: prepared.name, files };
  }

  const patches = join(prepared.main, PATCHES_DIR);
  await mkdir(patches, { recursive: true });
  await keepOutOfGit(patches);
  const patchPath = join(patches, `${prepared.name}.patch`);
  const handoffPath = join(patches, `${prepared.name}.md`);
  await writeFile(patchPath, patch);
  await writeFile(
    handoffPath,
    [
      `# ${agent.name}`,
      "",
      "## Task",
      task,
      "",
      `## Base commit\n${prepared.base}`,
      "",
      "## Files",
      ...files.map((file) => `- ${file}`),
      "",
      "## Diff stat",
      diffStat.trimEnd(),
      "",
      `## Patch\n${patchPath}`,
      "",
      "## Summary",
      answer,
      "",
    ].join("\n"),
  );
  await session.worktrees.discard(prepared.name);

  return { name: prepared.name, files, patchPath, handoffPath, diffStat };
}

/** `sub-<slug>-<n>` with the first `n` that has neither a worktree nor a saved patch, so no unapplied patch is lost. */
async function freeName(session: Session, main: string, agentName: string): Promise<string> {
  const taken = new Set((await session.worktrees.list()).flatMap((worktree) => worktree.managedName ?? []));
  const slug = slugify(agentName, MAX_SLUG_CHARS, "writer");
  for (let number = 1; ; number++) {
    const name = `sub-${slug}-${number}`;
    if (!taken.has(name) && !existsSync(join(main, PATCHES_DIR, `${name}.patch`))) return name;
  }
}
