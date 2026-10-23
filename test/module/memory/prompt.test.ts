import { describe, expect, it } from "vitest";
import { memoryPrompt } from "#module/memory/prompt";

describe("memoryPrompt", () => {
  it("lists each scope under its folder after the conventions, flagging links that resolve in neither scope", () => {
    const prompt = memoryPrompt(
      {
        dir: "/project/.pi/memories",
        memories: [
          { name: "build/tests", description: "How to run the tests", links: ["gotchas/reload", "style", "missing"] },
          { name: "gotchas/reload", description: undefined, links: ["old-name"] },
        ],
      },
      { dir: "/agent/memories", memories: [{ name: "style", description: "How I work", links: [] }] },
    );
    expect(prompt).toMatch(/^You have persistent memory/);
    expect(prompt.slice(prompt.indexOf("\n\nProject memories"))).toBe(
      [
        "",
        "",
        "Project memories (/project/.pi/memories):",
        "- build/tests — How to run the tests (broken links: [[missing]])",
        "- gotchas/reload (broken links: [[old-name]])",
        "",
        "Global memories (/agent/memories):",
        "- style — How I work",
      ].join("\n"),
    );
  });

  it("says when a scope's folder can't be read", () => {
    const prompt = memoryPrompt({ dir: "/p", memories: undefined }, { dir: "/g", memories: [] });
    expect(prompt).toContain("Project memories (/p):\n(this folder can't be read)");
  });

  // The agent still needs the folder to write its first memory.
  it("shows an empty scope's folder", () => {
    const prompt = memoryPrompt({ dir: "/p", memories: [] }, { dir: "/g", memories: [] });
    expect(prompt).toContain("Project memories (/p):\n(none yet)");
  });
});
