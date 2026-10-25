import { describe, expect, it } from "vitest";
import type { Problem } from "#core/channels";
import { FileChangeKind } from "#core/util/walk";
import type { CommandFailure } from "#module/done-check/project-commands";
import { doneCheckReport, filesToCheck, MAX_CHECKED_FILES } from "#module/done-check/report";

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

/** The report for `problems` and `failures` in /p, with `skipped` changed files left out. */
const report = (problems: Problem[], failures: CommandFailure[] = [], skipped = 0) =>
  doneCheckReport({ problems, failures, skipped }, "/p");

describe("doneCheckReport", () => {
  it("lists the errors by file and line, with what to do", () => {
    const problems = [problem("/p/src/b.ts", 4), problem("/p/src/a.ts", 9), problem("/p/src/a.ts", 2)];
    expect(report(problems)).toBe(
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
    expect(report(problems)).toBeUndefined();
  });

  it("names a file outside the folder by its full path", () => {
    expect(report([problem("/elsewhere/x.ts", 1)])).toContain("\n/elsewhere/x.ts:1:1  bad 1");
  });

  it("cuts a long list, and says how many changed files weren't checked", () => {
    const problems = Array.from({ length: 25 }, (_, i) => problem("/p/a.ts", i + 1));
    const text = report(problems, [], 4) ?? "";
    expect(text.split("\n").filter((line: string) => line.startsWith("a.ts:"))).toHaveLength(20);
    expect(text).toContain("… and 5 more.\n4 more changed files weren't checked.\n");
  });

  it("lists each failed command with how it ended and its output, after the errors", () => {
    const failures: CommandFailure[] = [
      { command: "npm test", ended: { kind: "exit", code: 1 }, output: "FAIL a.test.ts\n  expected 2" },
      { command: "npm run slow", ended: { kind: "timeout" }, output: "" },
    ];
    expect(report([problem("/p/a.ts", 2)], failures)).toBe(
      [
        "Done check: 1 error in files changed during this run, and 2 check commands failed.",
        "a.ts:2:1  bad 2 (ts 1)",
        "`npm test` failed (exit 1):",
        "    FAIL a.test.ts",
        "      expected 2",
        "`npm run slow` failed (timed out after 120s):",
        "Fix these, or say why they're fine.",
      ].join("\n"),
    );
  });

  it("reports a failed command alone, and one that couldn't run", () => {
    const failure: CommandFailure = { command: "nope", ended: { kind: "error", message: "spawn failed" }, output: "" };
    expect(report([], [failure])).toBe(
      "Done check: 1 check command failed.\n`nope` failed (couldn't run: spawn failed):\nFix these, or say why they're fine.",
    );
  });
});
