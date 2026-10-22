import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestPlan, planFileName, savePlan, slugify } from "#module/plan-build/plan-file";

const now = new Date("2026-10-20T14:32:05.123Z");

describe("slugify", () => {
  it.each([
    ["Add submit_plan", "add-submit-plan"],
    ["  Fix: the /plan  command!  ", "fix-the-plan-command"],
    ["Ünïcode café", "n-code-caf"],
  ])("turns %j into %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it.each(["", "日本語"])("falls back to plan for %j", (title) => {
    expect(slugify(title)).toBe("plan");
  });

  // The cut can land on a dash, so the trim runs after it.
  it("caps the slug at 50 characters without a trailing dash", () => {
    const slug = slugify(`${"a".repeat(49)} bcd`);
    expect(slug).toBe("a".repeat(49));
    expect(slugify("word ".repeat(30)).length).toBeLessThanOrEqual(50);
  });
});

describe("planFileName", () => {
  it("is a UTC timestamp with seconds, then the slug", () => {
    expect(planFileName("Add submit_plan", now)).toBe("2026-10-20-143205-add-submit-plan.md");
  });

  // Slice 7 opens the latest plan by sorting names, so name order must be time order.
  it("sorts by time", () => {
    const names = ["2026-01-02T00:00:00Z", "2025-12-31T23:59:59Z", "2026-01-01T09:00:00Z"].map((t) =>
      planFileName("z", new Date(t)),
    );
    expect([...names].sort()).toEqual([names[1], names[2], names[0]]);
  });
});

describe("savePlan", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "mypi-plan-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const plansDir = () => join(cwd, ".pi", "plans");

  it("writes the plan under .pi/plans/ with the title as its heading", async () => {
    const path = await savePlan(cwd, "Add submit_plan", "\nSteps.\n\n", now);
    expect(path).toBe(join(plansDir(), "2026-10-20-143205-add-submit-plan.md"));
    expect(await readFile(path, "utf8")).toBe("# Add submit_plan\n\nSteps.\n");
  });

  it("creates the folder with a .gitignore of *", async () => {
    await savePlan(cwd, "a", "x", now);
    expect(await readFile(join(plansDir(), ".gitignore"), "utf8")).toBe("*\n");
  });

  it("never overwrites an existing .gitignore", async () => {
    await savePlan(cwd, "a", "x", now);
    await writeFile(join(plansDir(), ".gitignore"), "edited\n");
    await savePlan(cwd, "b", "x", now);
    expect(await readFile(join(plansDir(), ".gitignore"), "utf8")).toBe("edited\n");
    expect((await readdir(plansDir())).sort()).toEqual([
      ".gitignore",
      "2026-10-20-143205-a.md",
      "2026-10-20-143205-b.md",
    ]);
  });

  it("fails instead of overwriting a plan with the same name", async () => {
    await savePlan(cwd, "a", "first", now);
    await expect(savePlan(cwd, "a", "second", now)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(plansDir(), "2026-10-20-143205-a.md"), "utf8")).toBe("# a\n\nfirst\n");
  });

  // A read-only folder makes the .gitignore write fail with EACCES, which must not be swallowed like EEXIST.
  it("passes on a .gitignore error other than EEXIST", async () => {
    await mkdir(plansDir(), { recursive: true });
    await chmod(plansDir(), 0o500);
    try {
      await expect(savePlan(cwd, "a", "x", now)).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(plansDir(), 0o700);
    }
  });
});

describe("latestPlan", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "mypi-latest-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("is undefined when there's no plans folder", async () => {
    await expect(latestPlan(cwd)).resolves.toBeUndefined();
  });

  it("is undefined when the folder holds no plan, only its .gitignore", async () => {
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(join(cwd, ".pi", "plans", ".gitignore"), "*\n");
    await expect(latestPlan(cwd)).resolves.toBeUndefined();
  });

  it("is the newest plan, by its timestamp", async () => {
    await savePlan(cwd, "b", "x", new Date("2026-10-20T09:00:00Z"));
    const newest = await savePlan(cwd, "a", "x", new Date("2026-10-21T08:00:00Z"));
    await savePlan(cwd, "c", "x", new Date("2026-10-19T23:00:00Z"));
    await writeFile(join(cwd, ".pi", "plans", "zz-notes.txt"), "");
    await expect(latestPlan(cwd)).resolves.toBe(newest);
  });

  it("passes on a read error other than a missing folder", async () => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "plans"), "not a folder");
    await expect(latestPlan(cwd)).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
