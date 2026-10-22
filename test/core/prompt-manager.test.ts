import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PromptManager } from "#core/prompt-manager";

/** Pi's rule for section names (`SYSTEM_PROMPT_SECTION_NAME` in `dist/core/system-prompt.js`); a bad name fails every prompt. */
const SECTION_NAME = /^[a-z][a-z0-9_-]*$/;

/** What `apply` writes into an empty sections object. */
function applied(prompts: PromptManager) {
  const sections: Record<string, string> = {};
  prompts.apply(sections);
  return sections;
}

const newPromptManager = () => new PromptManager({} as ExtensionContext);

describe("PromptManager", () => {
  it("writes nothing when no prompt is set", () => {
    expect(applied(newPromptManager())).toEqual({});
  });

  it("writes each prompt as the mypi-<name> section", () => {
    const prompts = newPromptManager();
    prompts.set("plan-build", "plan text");
    prompts.set("other", "other text");
    expect(applied(prompts)).toEqual({ "mypi-plan-build": "plan text", "mypi-other": "other text" });
  });

  // Leaving Plan replaces the text under the same name, so pi sends an update rather than a removal.
  it("replaces a prompt set again under the same name, and clears one set to undefined", () => {
    const prompts = newPromptManager();
    prompts.set("plan-build", "plan text");
    prompts.set("plan-build", "build text");
    expect(applied(prompts)).toEqual({ "mypi-plan-build": "build text" });
    prompts.set("plan-build", undefined);
    expect(applied(prompts)).toEqual({});
  });

  it("leaves sections from pi and other extensions alone", () => {
    const prompts = newPromptManager();
    prompts.set("plan-build", "plan text");
    const sections = { tool_guidance: "theirs" };
    prompts.apply(sections);
    expect(sections).toEqual({ tool_guidance: "theirs", "mypi-plan-build": "plan text" });
  });

  it("writes section names pi accepts", () => {
    const prompts = newPromptManager();
    prompts.set("plan-build", "plan text");
    for (const name of Object.keys(applied(prompts))) expect(name).toMatch(SECTION_NAME);
  });
});
