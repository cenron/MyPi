import { expect, it } from "vitest";
import { promptSection } from "#module/subagents/index";

it("says when to delegate, then lists each agent with its run settings", () => {
  const explore = {
    name: "explore",
    description: "Search widely",
    access: "read-only" as const,
    model: "inherit",
    thinking: "inherit" as const,
    prompt: "",
  };
  expect(promptSection([explore]).split("\n")).toEqual([
    "## Subagents",
    expect.stringContaining("more than about three queries"),
    "- explore: Search widely (model: inherit; thinking: inherit; access: read-only)",
  ]);
});
