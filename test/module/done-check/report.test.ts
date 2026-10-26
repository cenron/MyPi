import { describe, expect, it } from "vitest";
import type { Duplicate, OpenTask, Problem } from "#core/channels";
import { FileChangeKind } from "#core/util/walk";
import type { CommandFailure } from "#module/done-check/project-commands";
import {
  changesNotIgnored,
  doneCheckPassed,
  doneCheckReport,
  filesToCheck,
  MAX_CHECKED_FILES,
} from "#module/done-check/report";

/** A problem in `file` at `line`, an error unless `severity` says otherwise. */
function problem(file: string, line: number, severity: Problem["severity"] = "error"): Problem {
  return { file, line, column: 1, severity, message: `bad ${line}`, origin: "ts 1" };
}

describe("changesNotIgnored", () => {
  it("drops ignored files and folders on path boundaries", () => {
    const changes = [
      { file: "/p/coverage/index.js", kind: FileChangeKind.CREATED },
      { file: "/p/local.log", kind: FileChangeKind.CHANGED },
      { file: "/p/src/app.ts", kind: FileChangeKind.CHANGED },
      { file: "/p/coverage-report.md", kind: FileChangeKind.CREATED },
    ];
    expect(changesNotIgnored(changes, ["coverage/", "local.log"], "/p")).toEqual([changes[2], changes[3]]);
  });
});

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
const report = (
  problems: Problem[],
  failures: CommandFailure[] = [],
  skipped = 0,
  openTasks: OpenTask[] = [],
  duplicates: Duplicate[] = [],
) => doneCheckReport({ problems, failures, skipped, openTasks, duplicates }, "/p");

describe("doneCheckPassed", () => {
  it.each([
    [
      "diagnostics and commands",
      ["lsp"],
      ["npm run check"],
      3,
      "Done check passed: lsp checked 3 changed files; npm run check passed.",
    ],
    ["diagnostics alone", ["lsp", "typescript"], [], 1, "Done check passed: lsp, typescript checked 1 changed file."],
    ["commands alone", [], ["true"], 2, "Done check passed: true passed."],
    ["nothing ran", [], [], 2, undefined],
  ])("reports %s only", (_case, sources, commands, files, expected) => {
    expect(doneCheckPassed(sources, commands, files)).toBe(expected);
  });
});

describe("doneCheckReport", () => {
  it("lists duplicate names with their source locations and reuse guidance", () => {
    expect(
      report(
        [],
        [],
        0,
        [],
        [{ name: "formatPrice", file: "/p/src/cart.ts", line: 4, elsewhere: { file: "/p/src/price.ts", line: 2 } }],
      ),
    ).toBe(
      "Done check:\n1 new name already exists elsewhere:\n`formatPrice` (src/cart.ts:4) is also in src/price.ts:2\n" +
        "Reuse the existing one, or say why a second one is right.",
    );
  });
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

  it.each([
    [
      "open tasks alone",
      [],
      [],
      [
        { id: "3", subject: "Write tests", status: "in_progress" },
        { id: "4", subject: "Live check", status: "pending" },
      ] as OpenTask[],
      "Done check:\n2 tasks still open:\n#3 [in_progress] Write tests\n#4 [pending] Live check\n" +
        "Finish these tasks, or mark each completed or deleted and say why. If the user asked you to stop before them, leave them open and say so.",
    ],
    [
      "open tasks with errors",
      [problem("/p/a.ts", 1)],
      [],
      [{ id: "1", subject: "Run tests", status: "pending" }] as OpenTask[],
      "Done check: 1 error in files changed during this run.\na.ts:1:1  bad 1 (ts 1)\n" +
        "1 task still open:\n#1 [pending] Run tests\nFix these, or say why they're fine.\n" +
        "Finish these tasks, or mark each completed or deleted and say why. If the user asked you to stop before them, leave them open and say so.",
    ],
    [
      "subjects with commas and line breaks remain on their task line",
      [],
      [],
      [
        { id: "1", subject: "Write tests, then\nrun them", status: "pending" },
        { id: "2", subject: "Live check", status: "in_progress" },
      ] as OpenTask[],
      "Done check:\n2 tasks still open:\n#1 [pending] Write tests, then run them\n#2 [in_progress] Live check\n" +
        "Finish these tasks, or mark each completed or deleted and say why. If the user asked you to stop before them, leave them open and say so.",
    ],
    ["no open tasks", [], [], [], undefined],
  ])("reports %s", (_case, problems, failures, openTasks, expected) => {
    expect(report(problems, failures, 0, openTasks)).toBe(expected);
  });

  it("reports a failed command alone, and one that couldn't run", () => {
    const failure: CommandFailure = { command: "nope", ended: { kind: "error", message: "spawn failed" }, output: "" };
    expect(report([], [failure])).toBe(
      "Done check: 1 check command failed.\n`nope` failed (couldn't run: spawn failed):\nFix these, or say why they're fine.",
    );
  });
});
