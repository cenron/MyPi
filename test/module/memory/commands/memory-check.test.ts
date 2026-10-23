import { describe, expect, it } from "vitest";
import { checkReport } from "#module/memory/commands/memory-check";
import { INVALID_FRONTMATTER } from "#module/memory/folders";

const memory = (name: string, links: string[] = [], description?: string) => ({ name, description, links });

describe("checkReport", () => {
  it("says there are no problems, counting the memories", () => {
    const report = checkReport([
      { dir: "/p", memories: [memory("build", ["style"])] },
      { dir: "/g", memories: [memory("style")] },
    ]);
    expect(report).toBe("Memory check: no problems in 2 memories.");
  });

  it("lists each problem by file: unreadable folders, invalid frontmatter, broken links", () => {
    const report = checkReport([
      { dir: "/p", memories: [memory("build", ["missing", "style"], INVALID_FRONTMATTER), memory("ok")] },
      { dir: "/g", memories: [memory("style")] },
      { dir: "/x", memories: undefined },
    ]);
    expect(report).toBe(
      [
        "Memory check: 3 problems.",
        "- /p/build.md: frontmatter isn't valid YAML",
        "- /p/build.md: broken links: [[missing]]",
        "- /x: the folder can't be read",
      ].join("\n"),
    );
  });
});
