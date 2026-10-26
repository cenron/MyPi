import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestPlan, planFileName, savePlan } from "#module/plan-build/plan-file";

const now = new Date("2026-10-20T14:32:05.123Z");

describe("planFileName", () => {
  it("is a UTC timestamp with seconds, then the slug", () => {
    expect(planFileName("Add submit_plan", now)).toBe("2026-10-20-143205-add-submit-plan.md");
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
    const path = await savePlan(plansDir(), "Add submit_plan", "\nSteps.\n\n", now);
    expect(path).toBe(join(plansDir(), "2026-10-20-143205-add-submit-plan.md"));
    expect(await readFile(path, "utf8")).toBe("# Add submit_plan\n\nSteps.\n");
  });

  it("creates the folder with a .gitignore of *", async () => {
    await savePlan(plansDir(), "a", "x", now);
    expect(await readFile(join(plansDir(), ".gitignore"), "utf8")).toBe("*\n");
  });

  it("fails instead of overwriting a plan with the same name", async () => {
    await savePlan(plansDir(), "a", "first", now);
    await expect(savePlan(plansDir(), "a", "second", now)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(plansDir(), "2026-10-20-143205-a.md"), "utf8")).toBe("# a\n\nfirst\n");
  });
});

describe("latestPlan", () => {
  let cwd: string;
  const plansDir = () => join(cwd, ".pi", "plans");
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "mypi-latest-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("is undefined when there's no plans folder", async () => {
    await expect(latestPlan(plansDir())).resolves.toBeUndefined();
  });

  it("is undefined when the folder holds no plan, only its .gitignore", async () => {
    await mkdir(join(cwd, ".pi", "plans"), { recursive: true });
    await writeFile(join(cwd, ".pi", "plans", ".gitignore"), "*\n");
    await expect(latestPlan(plansDir())).resolves.toBeUndefined();
  });

  it("is the newest plan, by its timestamp", async () => {
    await savePlan(plansDir(), "b", "x", new Date("2026-10-20T09:00:00Z"));
    const newest = await savePlan(plansDir(), "a", "x", new Date("2026-10-21T08:00:00Z"));
    await savePlan(plansDir(), "c", "x", new Date("2026-10-19T23:00:00Z"));
    await writeFile(join(cwd, ".pi", "plans", "zz-notes.txt"), "");
    await expect(latestPlan(plansDir())).resolves.toBe(newest);
  });

  it("passes on a read error other than a missing folder", async () => {
    await mkdir(join(cwd, ".pi"), { recursive: true });
    await writeFile(join(cwd, ".pi", "plans"), "not a folder");
    await expect(latestPlan(plansDir())).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
