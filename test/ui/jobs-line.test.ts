import { describe, expect, it } from "vitest";
import type { JobInfo } from "#core/types";
import { jobsLine } from "#ui/jobs-line";

/** Marks each color, so a test sees which part is painted and that no markup is left for pi to print. */
const theme = { fg: (color: string, text: string) => `[${color}:${text}]` };

function job(label: string, startedAt: number): JobInfo {
  return { id: "1", kind: "shell", label, status: "running", startedAt, logPath: "job.log" };
}

describe("jobsLine", () => {
  it.each([
    { jobs: [], expected: undefined },
    { jobs: [job("npm test", Date.now())], expected: /^\[accent:1 running\] · npm test 0\.0s · \[dim:\/jobs\]$/ },
    {
      jobs: [job(`reviewer: ${"x".repeat(30)}`, Date.now()), job("sleep 30", Date.now())],
      expected: /2 running.*reviewer: x{13}… 0\.0s.*sleep 30 0\.0s.*\/jobs/,
    },
  ])("renders $jobs", ({ jobs, expected }) => {
    const line = jobsLine(jobs, theme);
    if (expected instanceof RegExp) expect(line?.[0]).toMatch(expected);
    else expect(line).toBe(expected);
  });
});
