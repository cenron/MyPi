import { describe, expect, it } from "vitest";
import { projectPattern } from "#module/analytics/queries";

describe("projectPattern", () => {
  it.each([
    ["job-search-hub", "%job-search-hub%"],
    ["agentic_workspace", "%agentic\\_workspace%"],
    ["100%", "%100\\%%"],
    ["a\\b", "%a\\\\b%"],
  ])("turns %s into the LIKE pattern %s", (project, pattern) => {
    expect(projectPattern(project)).toBe(pattern);
  });
});
