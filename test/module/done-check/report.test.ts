import { describe, expect, it } from "vitest";
import type { Problem } from "#core/channels";
import { FileChangeKind } from "#core/util/walk";
import { errorsReport, filesToCheck, MAX_CHECKED_FILES } from "#module/done-check/report";

/** A problem in `file` at `line`, an error unless `severity` says otherwise. */
function problem(file: string, line: number, severity: Problem["severity"] = "error"): Problem {
  return { file, line, column: 1, severity, message: `bad ${line}`, origin: "ts 1" };
}

describe("filesToCheck", () => {
  it("keeps created and changed files, not deleted ones", () => {
    const changes = [
      { file: "/p/a.ts", kind: FileChangeKind.CHANGED },
      { file: "/p/b.ts", kind: FileChangeKind.DELETED },
      { file: "/p/c.ts", kind: FileChangeKind.CREATED },
    ];
    expect(filesToCheck(changes)).toEqual({ files: ["/p/a.ts", "/p/c.ts"], skipped: 0 });
  });

  it("checks at most MAX_CHECKED_FILES, counting the rest", () => {
    const changes = Array.from({ length: MAX_CHECKED_FILES + 3 }, (_, i) => ({
      file: `/p/${i}.ts`,
      kind: FileChangeKind.CHANGED,
    }));
    const { files, skipped } = filesToCheck(changes);
    expect(files).toHaveLength(MAX_CHECKED_FILES);
    expect(skipped).toBe(3);
  });
});

describe("errorsReport", () => {
  it("lists the errors by file and line, with what to do", () => {
    const problems = [problem("/p/src/b.ts", 4), problem("/p/src/a.ts", 9), problem("/p/src/a.ts", 2)];
    expect(errorsReport(problems, "/p")).toBe(
      [
        "Done check: 3 errors in files changed during this run.",
        "src/a.ts:2:1  bad 2 (ts 1)",
        "src/a.ts:9:1  bad 9 (ts 1)",
        "src/b.ts:4:1  bad 4 (ts 1)",
        "Fix these, or say why they're fine.",
      ].join("\n"),
    );
  });

  it.each([
    ["no problems", []],
    ["only warnings and hints", [problem("/p/a.ts", 1, "warning"), problem("/p/a.ts", 2, "hint")]],
  ])("is undefined for %s, so the check stays quiet", (_case, problems) => {
    expect(errorsReport(problems, "/p")).toBeUndefined();
  });

  it("names a file outside the folder by its full path", () => {
    expect(errorsReport([problem("/elsewhere/x.ts", 1)], "/p")).toContain("\n/elsewhere/x.ts:1:1  bad 1");
  });

  it("cuts a long list, and says how many changed files weren't checked", () => {
    const problems = Array.from({ length: 25 }, (_, i) => problem("/p/a.ts", i + 1));
    const report = errorsReport(problems, "/p", 4) ?? "";
    expect(report.split("\n").filter((line) => line.startsWith("a.ts:"))).toHaveLength(20);
    expect(report).toContain("… and 5 more.\n4 more changed files weren't checked.\n");
  });
});
