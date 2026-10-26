import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "#core/util/errors";
import { keepOutOfGit } from "#core/util/git";
import { slugify } from "#core/util/slug";

/** Relative to the main checkout, or cwd outside Git; registered as writable in Plan. */
export const PLANS_DIR = join(".pi", "plans");

const MAX_SLUG = 50;

/**
 * `<UTC timestamp>-<slug>.md`, like `2026-10-20-143205-add-submit-plan.md`. UTC, so names sort by time even across a
 * DST change; seconds, so two plans in one minute don't collide.
 */
export function planFileName(title: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "");
  return `${stamp}-${slugify(title, MAX_SLUG, "plan")}.md`;
}

/**
 * Writes to the resolved plans folder and returns its path, keeping the folder out of git with `keepOutOfGit`. The
 * plan file is never overwritten.
 */
export async function savePlan(dir: string, title: string, plan: string, now: Date): Promise<string> {
  await mkdir(dir, { recursive: true });
  await keepOutOfGit(dir);

  const path = join(dir, planFileName(title, now));
  await writeFile(path, `# ${title}\n\n${plan.trim()}\n`, { flag: "wx" });
  return path;
}

/**
 * The newest plan in the resolved folder, or undefined when there is none. Names start with a UTC timestamp, so the
 * last by name is the newest.
 */
export async function latestPlan(dir: string): Promise<string | undefined> {
  const names = await readdir(dir).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  const latest = names
    .filter((name) => name.endsWith(".md"))
    .sort()
    .at(-1);
  return latest === undefined ? undefined : join(dir, latest);
}
