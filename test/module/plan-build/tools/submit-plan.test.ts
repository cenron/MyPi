import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitPlanTool } from "#module/plan-build/tools/submit-plan";

const now = new Date("2026-10-20T14:32:05Z");

describe("submitPlanTool", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "mypi-submit-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const run = (onSubmit = vi.fn()) =>
    submitPlanTool(onSubmit, () => now).execute("call-1", { title: "Add it", plan: "Steps." }, undefined, undefined, {
      cwd,
    } as ExtensionToolContext);

  it("saves the plan in the session's cwd and tells the model where", async () => {
    const path = join(cwd, ".pi", "plans", "2026-10-20-143205-add-it.md");
    await expect(run()).resolves.toEqual({
      content: [{ type: "text", text: `Plan saved to ${path}.` }],
      details: { path },
    });
    expect(await readFile(path, "utf8")).toBe("# Add it\n\nSteps.\n");
  });

  it("hands the submitted plan to onSubmit", async () => {
    const onSubmit = vi.fn();
    await run(onSubmit);
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Add it",
      plan: "Steps.",
      path: join(cwd, ".pi", "plans", "2026-10-20-143205-add-it.md"),
    });
  });

  // Pi turns a throw into an error result for the model; onSubmit must not see a plan that wasn't saved.
  it("throws without calling onSubmit when the file exists", async () => {
    await run();
    const onSubmit = vi.fn();
    await expect(run(onSubmit)).rejects.toMatchObject({ code: "EEXIST" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
