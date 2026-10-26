import { expect, it } from "vitest";
import { promptSection } from "#module/subagents/index";

it("lists agent description and run settings with delegation guidance", () => {
  expect(
    promptSection([
      {
        name: "explore",
        description: "Search widely",
        access: "read-only",
        model: "inherit",
        thinking: "inherit",
        prompt: "",
      },
    ]),
  ).toBe(
    [
      "## Subagents",
      "Delegate wide searches, independent checks, or tasks that would flood this context; don't delegate quick lookups or one-file changes.",
      "- explore: Search widely (model: inherit; thinking: inherit; access: read-only)",
    ].join("\n"),
  );
});
