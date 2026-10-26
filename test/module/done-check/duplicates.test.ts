import { describe, expect, it } from "vitest";
import type { Duplicate } from "#core/channels";
import { MAX_REPORTED_DUPLICATES, reportedDuplicates } from "#module/done-check/duplicates";

function duplicate(name: string): Duplicate {
  return { name, file: "src/a.ts", line: 1, elsewhere: { file: "src/b.ts", line: 2 } };
}

describe("reportedDuplicates", () => {
  it.each([
    { duplicates: [duplicate("a"), duplicate("b")], reported: new Set(["a"]), expected: ["b"] },
    {
      duplicates: Array.from({ length: MAX_REPORTED_DUPLICATES + 1 }, (_, index) => duplicate(String(index))),
      reported: new Set<string>(),
      expected: Array.from({ length: MAX_REPORTED_DUPLICATES + 1 }, (_, index) => String(index)),
    },
  ])("filters names already reported and remembers only the report limit", ({ duplicates, reported, expected }) => {
    const result = reportedDuplicates(duplicates, reported);
    expect(result.duplicates.map(({ name }) => name)).toEqual(expected);
    expect([...result.reported]).toEqual([...new Set([...reported, ...expected.slice(0, MAX_REPORTED_DUPLICATES)])]);
    expect(reported.has("b")).toBe(false);
  });
});
