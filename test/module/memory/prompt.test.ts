import { describe, expect, it } from "vitest";
import { memoryPrompt } from "#module/memory/prompt";

describe("memoryPrompt", () => {
  it("lists each scope under its folder, after the conventions", () => {
    const prompt = memoryPrompt(
      {
        dir: "/project/.pi/memories",
        memories: [
          { name: "build/tests", description: "How to run the tests" },
          { name: "gotchas/reload", description: undefined },
        ],
      },
      { dir: "/agent/memories", memories: undefined },
    );
    expect(prompt).toMatch(/^You have persistent memory/);
    expect(prompt.slice(prompt.indexOf("\n\nProject memories"))).toBe(
      [
        "",
        "",
        "Project memories (/project/.pi/memories):",
        "- build/tests — How to run the tests",
        "- gotchas/reload",
        "",
        "Global memories (/agent/memories):",
        "(this folder can't be read)",
      ].join("\n"),
    );
  });

  // The agent still needs the folder to write its first memory.
  it("shows an empty scope's folder", () => {
    const prompt = memoryPrompt({ dir: "/p", memories: [] }, { dir: "/g", memories: [] });
    expect(prompt).toContain("Project memories (/p):\n(none yet)");
  });
});
