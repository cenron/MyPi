import { describe, expect, it } from "vitest";
import { slugify } from "#core/util/slug";

describe("slugify", () => {
  it.each([
    ["Add submit_plan", 50, "add-submit-plan"],
    ["  Fix: the /plan  command!  ", 50, "fix-the-plan-command"],
    ["Ünïcode café", 50, "n-code-caf"],
    ["My Reviewer", 50, "my-reviewer"],
    ["日本語", 50, "fallback"],
    ["!!!", 50, "fallback"],
    // The cut can land on a dash, so the trim runs after it.
    [`${"a".repeat(9)} bcd`, 10, "a".repeat(9)],
  ])("turns %j (max %i) into %j", (text, max, slug) => {
    expect(slugify(text, max, "fallback")).toBe(slug);
  });
});
