import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { identityPrompt, MYPI_ROOT } from "#core/identity";

const model = { provider: "openai", id: "gpt-6.1-sol" } as ExtensionContext["model"];

describe("identityPrompt", () => {
  it("says it's MyPi on pi, with the model and the running modules", () => {
    const prompt = identityPrompt(model, ["plan-build", "memory"], "/mypi");
    expect(prompt).toContain("You are MyPi, a coding agent running on the pi agent harness.");
    expect(prompt).toContain("Model: openai/gpt-6.1-sol. Modules running: plan-build, memory.");
  });

  it("says so plainly when no model is picked yet", () => {
    expect(identityPrompt(undefined, [], "/mypi")).toContain("Model: none picked yet.");
  });

  // The point of the section: "what's on your roadmap?" reads the file instead of searching for it.
  it("gives the full paths to its own map, roadmap, principles, and design docs", () => {
    const prompt = identityPrompt(model, [], "/mypi");
    for (const path of ["/mypi/AGENTS.md", "/mypi/docs/roadmap.md", "/mypi/docs/principles.md", "/mypi/docs/{"]) {
      expect(prompt).toContain(path);
    }
  });
});

// A wrong count of `../` would point the agent at a folder with no docs, and nothing else would notice.
it("finds MyPi's root from its own file", () => {
  expect(existsSync(join(MYPI_ROOT, "AGENTS.md"))).toBe(true);
  expect(existsSync(join(MYPI_ROOT, "docs/roadmap.md"))).toBe(true);
});
