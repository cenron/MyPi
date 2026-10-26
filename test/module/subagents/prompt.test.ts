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
    source: "builtin" as const,
    path: "/builtins/explore.md",
  };
  expect(promptSection([explore]).split("\n")).toEqual([
    "## Subagents",
    expect.stringContaining("more than about three queries"),
    "To create, change, or remove an agent, find `agent_manage` with `tool_search`.",
    "- explore: Search widely (model: inherit; thinking: inherit; access: read-only)",
  ]);
  expect(promptSection([explore])).toContain(
    "offer to take that step here, where the user can approve it. Don't retry the child with the same call",
  );
  expect(promptSection([explore])).toContain("ask it for the change itself, never for a patch");
  expect(promptSection([explore])).toContain("apply it only with `subagent_apply`");
});
