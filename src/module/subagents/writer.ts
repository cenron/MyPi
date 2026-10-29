import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ask } from "#core/events";
import type { Session } from "#core/session";
import { errorMessage, isNodeError } from "#core/util/errors";
import { keepOutOfGit } from "#core/util/git";
import { slugify } from "#core/util/slug";
import { git } from "#core/worktree/git";
import type { AgentDefinition } from "./agents";
import type { ChildResult, ChildRun } from "./child";
import { runChild } from "./child";

/** A writer's isolated checkout and the commit its patch must include changes from. */
type PreparedWriter = {
  readonly name: string;
  readonly base: string;
  readonly path: string;
  readonly main: string;
  readonly dependencies: readonly string[];
};

/** Saved patch details for a writer with changes; no-change runs have no handoff files. */
type CapturedWork = {
  readonly name: string;
  readonly files: string[];
  readonly patchPath?: string;
  readonly handoffPath?: string;
  readonly diffStat?: string;
};

/** Where patches and handoffs wait, under the main checkout; kept out of git. */
export const PATCHES_DIR = join(".pi", "patches");

/** Result of a write run, including where its work was returned. */
export type WriterResult = ChildResult & {
  readonly patchName?: string;
  readonly inPlace?: boolean;
  readonly failure?: string;
  readonly stopped?: boolean;
};

/** `git rev-parse --verify --quiet`'s exit code, with no message, when the name isn't a commit. */
const NOT_A_COMMIT = 1;

/** The handoff's task and summary for work recovered from a writer that didn't finish. */
const RECOVERED_TASK = "Unknown: pi closed before this writer finished.";
const RECOVERED_ANSWER = "pi closed while this writer was running; the patch holds what it had changed by then.";

/** What every writer worktree's name starts with: `sub-<agent>-<n>`. */
const WRITER_PREFIX = "sub-";

/** Longest agent-name part of a worktree name, leaving room for `sub-` and the number. */
const MAX_SLUG_CHARS = 40;

/** Serializes name allocation and worktree creation for concurrent writer starts in one session. */
const writerStarts = new WeakMap<Session, Promise<void>>();

/**
 * Creates the writer's private worktree at the caller's committed HEAD. Refuses outside a git project, and when the
 * checkout has uncommitted changes the writer wouldn't see.
 */
export async function prepareWriter(session: Session, agent: AgentDefinition): Promise<PreparedWriter> {
  const project = session.project;
  if (!project) throw new Error("A worktree writer needs a git project.");
  if (!(await hasCommit(session.ctx.cwd))) {
    throw new Error(
      `Cannot start ${agent.name} in a worktree: this repository has no commit yet, and a worktree starts from one. ` +
        "Ask the user to make a first commit, then try again.",
    );
  }

  const status = await git(session.ctx.cwd, ["status", "--porcelain"]);
  if (status) {
    throw new Error(`Cannot start ${agent.name} in a worktree while this checkout has uncommitted changes:\n${status}`);
  }

  return withWriterStart(session, async () => {
    const name = await freeName(session, project.main, agent.name);
    const base = (await git(session.ctx.cwd, ["rev-parse", "HEAD"])).trim();
    const worktree = await session.worktrees.create(name);
    const dependencies = await linkDependencies(project.main, worktree.path);
    // Beside the checkout, in the ignored worktrees folder: which pi runs this writer, for `recoverWriters`.
    await writeFile(ownerFile(worktree.path), String(process.pid));
    return { name, base, path: worktree.path, main: project.main, dependencies };
  });
}

/** Runs a writer in a private checkout when possible, and captures its work even when its run is stopped. */
export async function runWriter(session: Session, run: ChildRun, runChildSession = runChild): Promise<WriterResult> {
  if (!session.project) {
    return { ...(await runChildSession(run)), inPlace: true };
  }

  const { agent, task, signal } = run;
  const prepared = await prepareWriter(session, agent);
  const taskWithPlan = writerTask(prepared, task, await activePlan(session));
  let result: ChildResult;
  try {
    result = await runChildSession({ ...run, task: taskWithPlan }, prepared.path);
  } catch (error) {
    const captured = await captureWork(
      session,
      prepared,
      agent,
      task,
      error instanceof Error ? error.message : String(error),
    );
    const failure = error instanceof Error ? error.message : String(error);
    return {
      answer: "The writer did not finish.",
      usage: { tokens: 0, cost: 0 },
      sessionFile: undefined,
      changedFiles: captured.files,
      timedOut: false,
      patchName: captured.patchPath ? captured.name : undefined,
      failure,
      stopped: signal.aborted,
    };
  }

  const captured = await captureWork(session, prepared, agent, task, result.answer);
  return {
    ...result,
    changedFiles: captured.files,
    patchName: captured.patchPath ? captured.name : undefined,
    stopped: signal.aborted,
  };
}

/** The plan file the Build session is implementing, read for the writer's task; a missing one is reported. */
async function activePlan(session: Session): Promise<string | undefined> {
  const answers = await ask(session.pi.events, "plan", undefined);
  const [path] = answers.flatMap((answer) => (answer.kind === "answer" ? [answer.value] : []));
  if (!path) return undefined;

  try {
    return await readFile(path, "utf8");
  } catch (error) {
    session.logWarning(
      `Subagents: couldn't read the plan at ${path}: ${errorMessage(error)}; the writer goes without it.`,
    );
    return undefined;
  }
}

/**
 * The writer's full task: where it works, the active plan when Build has one, and the caller's task. Only the caller's
 * task has paths repointed into the worktree; the plan is quoted as written.
 */
function writerTask(prepared: PreparedWriter, task: string, plan: string | undefined): string {
  const header =
    `You work in your own worktree of this project: ${prepared.path}. Make the changes directly in its files. ` +
    `It holds the project's files at the same paths as ${prepared.main}; work on them here. Don't commit, ` +
    "and don't write patch files, even if asked: when you finish, MyPi turns your edits into a patch for the user.\n\n";
  const callerTask = rewriteWriterTaskPaths(task, prepared.main, prepared.path);
  const dependencies = dependenciesSection(prepared.dependencies);
  if (!plan) return header + dependencies + callerTask;

  return `${header}${dependencies}## The plan this implements\n${plan.trimEnd()}\n\n## Your task\n${callerTask}`;
}

/** What the writer may run against, and what it must not change: the main checkout's linked dependencies. */
function dependenciesSection(dependencies: readonly string[]): string {
  if (!dependencies.length) {
    return (
      "## Dependencies\nNo dependencies are installed here, so a check that needs them can't run; run the checks " +
      "you can and report the ones you couldn't.\n\n"
    );
  }

  const dirs = dependencies.map((dir) => `\`${dir}\``).join(", ");
  return (
    `## Dependencies\n${dirs} are the main checkout's, linked into this worktree; run the project's checks here, but ` +
    "never run `npm install`, `npm ci`, or anything else that changes `node_modules`. If a change needs a new " +
    "dependency, say so in your report.\n\n"
  );
}

/** The main checkout's ignored `node_modules` folders, nested ones included, as git names them (`node_modules/`). */
async function ignoredNodeModules(main: string): Promise<string[]> {
  return (await git(main, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]))
    .split("\0")
    .filter((entry) => entry === "node_modules/" || entry.endsWith("/node_modules/"));
}

/** Links each ignored `node_modules` from the main checkout into `worktree`; returns their relative dirs. */
async function linkDependencies(main: string, worktree: string): Promise<string[]> {
  const dependencies = (await ignoredNodeModules(main)).map((dir) => dir.replace(/\/$/, ""));
  for (const dir of dependencies) {
    await mkdir(join(worktree, dir, ".."), { recursive: true });
    await symlink(join(main, dir), join(worktree, dir), "dir");
  }
  return dependencies;
}

/** The ignored `node_modules` the worktree has as symlinks: what staging must exclude. */
async function linkedDependencies(main: string, worktree: string): Promise<string[]> {
  const linked: string[] = [];
  for (const entry of await ignoredNodeModules(main)) {
    const dir = entry.replace(/\/$/, "");
    try {
      if ((await lstat(join(worktree, dir))).isSymbolicLink()) linked.push(dir);
    } catch (error) {
      if (!isNodeError(error) || (error.code !== "ENOENT" && error.code !== "ENOTDIR")) throw error;
    }
  }
  return linked;
}

/** Repoints task paths into the writer's worktree without rewriting paths already there. */
function rewriteWriterTaskPaths(task: string, main: string, worktree: string): string {
  return task.replaceAll(`${main}/`, (prefix, offset: number) =>
    task.startsWith(`${worktree}/`, offset) ? prefix : `${worktree}/`,
  );
}

/** Saves all work since `base`, including the writer's own commits, before discarding its checkout. */
export async function captureWork(
  session: Session,
  prepared: PreparedWriter,
  agent: Pick<AgentDefinition, "name">,
  task: string,
  answer: string,
): Promise<CapturedWork> {
  const links = await linkedDependencies(prepared.main, prepared.path);
  await git(prepared.path, ["add", "-A", "--", ".", ...links.map((dir) => `:(exclude)${dir}`)]);
  const patch = await git(prepared.path, ["diff", "--cached", "--binary", prepared.base]);
  const diffStat = await git(prepared.path, ["diff", "--cached", "--stat", prepared.base]);
  const files = (await git(prepared.path, ["diff", "--cached", "--name-only", "-z", prepared.base]))
    .split("\0")
    .filter(Boolean);

  if (!files.length) {
    await discardWriter(session, prepared);
    return { name: prepared.name, files };
  }

  const patches = join(prepared.main, PATCHES_DIR);
  await mkdir(patches, { recursive: true });
  await keepOutOfGit(patches);
  const patchPath = join(patches, `${prepared.name}.patch`);
  const handoffPath = join(patches, `${prepared.name}.md`);
  await writeFile(patchPath, patch);
  await writeFile(handoffPath, handoffText({ agent, task, base: prepared.base, files, diffStat, patchPath, answer }));
  await discardWriter(session, prepared);

  return { name: prepared.name, files, patchPath, handoffPath, diffStat };
}

/**
 * Turns the writer worktrees a pi left when it quit mid-run into patches, as `captureWork` would have: pi's shutdown
 * stops jobs without waiting, so a running writer's work can't be captured then. Only worktrees whose pi is gone, so
 * another pi window's running writer is left alone.
 */
export async function recoverWriters(session: Session): Promise<CapturedWork[]> {
  const project = session.project;
  if (!project) return [];

  const orphans = (await session.worktrees.list()).filter(
    (worktree) => worktree.managedName?.startsWith(WRITER_PREFIX) && !ownerRunning(worktree.path),
  );
  const recovered: CapturedWork[] = [];
  for (const { managedName: name = "", path, head = "HEAD" } of orphans) {
    const base = (await git(project.main, ["merge-base", "HEAD", head])).trim();
    const agent = { name: name.slice(WRITER_PREFIX.length).replace(/-\d+$/, "") };
    recovered.push(
      await captureWork(
        session,
        { name, base, path, main: project.main, dependencies: [] },
        agent,
        RECOVERED_TASK,
        RECOVERED_ANSWER,
      ),
    );
  }
  return recovered;
}

/** Runs worktree allocation in order so simultaneous starts cannot choose the same free name. */
async function withWriterStart<T>(session: Session, start: () => Promise<T>): Promise<T> {
  const previous = writerStarts.get(session) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  writerStarts.set(
    session,
    previous.then(() => current),
  );
  await previous;
  try {
    return await start();
  } finally {
    release();
  }
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

/** The handoff note beside a patch: what the writer was asked, from which commit, what it changed, and its answer. */
function handoffText(work: {
  agent: Pick<AgentDefinition, "name">;
  task: string;
  base: string;
  files: readonly string[];
  diffStat: string;
  patchPath: string;
  answer: string;
}): string {
  return [
    `# ${work.agent.name}`,
    "",
    "## Task",
    work.task,
    "",
    `## Base commit\n${work.base}`,
    "",
    "## Files",
    ...work.files.map((file) => `- ${file}`),
    "",
    "## Diff stat",
    work.diffStat.trimEnd(),
    "",
    `## Patch\n${work.patchPath}`,
    "",
    "## Summary",
    work.answer,
    "",
  ].join("\n");
}

/** Whether the checkout's HEAD points at a commit; a new repository's doesn't until its first commit. */
async function hasCommit(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === NOT_A_COMMIT) return false;
    throw error;
  }
}

/** The file beside a writer's worktree naming the pi process that runs it. */
function ownerFile(worktreePath: string): string {
  return `${worktreePath}.owner`;
}

/** Discards a writer's worktree and branch, and the file naming its owner. */
async function discardWriter(session: Session, prepared: PreparedWriter): Promise<void> {
  await session.worktrees.discard(prepared.name);
  await rm(ownerFile(prepared.path), { force: true });
}

/** Whether the pi that started the writer at `worktreePath` still runs; a worktree with no owner file has none. */
function ownerRunning(worktreePath: string): boolean {
  let pid: number;
  try {
    pid = Number(readFileSync(ownerFile(worktreePath), "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: a process with that id runs, as another user.
    return isNodeError(error) && error.code === "EPERM";
  }
}
