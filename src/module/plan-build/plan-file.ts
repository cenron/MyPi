import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PLANS_DIR } from "./rule";

/** A plan the model submitted with `submit_plan`, and where it was saved. */
export type SubmittedPlan = { title: string; plan: string; path: string };

const MAX_SLUG = 50;

/** `title` as a file-name slug: lowercase, runs of anything but a-z and 0-9 become `-`; `plan` when nothing is left. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG)
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
}

/**
 * `<UTC timestamp>-<slug>.md`, like `2026-10-20-143205-add-submit-plan.md`. UTC, so names sort by time even across a
 * DST change; seconds, so two plans in one minute don't collide.
 */
export function planFileName(title: string, now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replace("T", "-").replaceAll(":", "");
  return `${stamp}-${slugify(title)}.md`;
}

/**
 * Writes the plan to `<cwd>/.pi/plans/` and returns its path. Creating the folder also writes a `.gitignore` of `*`,
 * so plans stay out of git without touching the project's own `.gitignore`. Neither file is ever overwritten.
 */
export async function savePlan(cwd: string, title: string, plan: string, now: Date): Promise<string> {
  const dir = join(cwd, PLANS_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });

  const path = join(dir, planFileName(title, now));
  await writeFile(path, `# ${title}\n\n${plan.trim()}\n`, { flag: "wx" });
  return path;
}
