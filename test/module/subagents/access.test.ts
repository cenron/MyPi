import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { checksPrompt, childAccess, READ_ONLY_PROMPT } from "#module/subagents/access";
import type { AgentDefinition } from "#module/subagents/agents";
import { fakeSession } from "../../fakes";

const agent = (access: AgentDefinition["access"]): AgentDefinition => ({
  name: "test-agent",
  description: "Test",
  access,
  model: "inherit",
  thinking: "inherit",
  prompt: "Test",
  source: "builtin",
  path: "/builtins/test-agent.md",
});

async function call(
  access: AgentDefinition["access"],
  toolName: string,
  input: Record<string, unknown>,
  checks: readonly string[] = [],
) {
  const fake = fakeSession();
  childAccess(agent(access), checks)(fake.session.pi);
  return fake.emit(
    "tool_call",
    { toolName, input } as ToolCallEvent,
    { ...fake.session.ctx, hasUI: false } as ExtensionContext,
  );
}

describe("child access", () => {
  it("blocks writes and unsafe bash for read-only agents with a reason", async () => {
    await expect(call("read-only", "edit", { path: "inside.ts" })).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("edit"),
    });
    await expect(call("read-only", "bash", { command: "touch inside.ts" })).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("Plan mode is on"),
    });
  });

  it("allows an in-folder edit for a writer and refuses any outside path", async () => {
    await expect(call("write", "edit", { path: "inside.ts" })).resolves.toBeUndefined();
    await expect(call("write", "read", { path: "/etc/passwd" })).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("no one can give it here"),
    });
  });

  it("fills the folder rule paths from pi's prompt", async () => {
    const fake = fakeSession();
    childAccess(agent("write"))(fake.session.pi);
    await fake.emit("before_agent_start", {
      systemPromptOptions: { skills: [], contextFiles: [{ path: "/prompt-context.md" }] },
    });
    await expect(
      fake.emit("tool_call", { toolName: "read", input: { path: "/prompt-context.md" } }, {
        ...fake.session.ctx,
        hasUI: false,
      } as ExtensionContext),
    ).resolves.toBeUndefined();
  });
});

describe("a read-only child's checks", () => {
  const CHECKS = ["npm run lint", "npm test -- --run"];

  it.each([
    ["an approved check", "npm run lint", true],
    ["an approved check after a cd inside the project", "cd frontend && npm run lint", true],
    ["an approved check with a file name", "npm test -- --run a.test.ts", true],
    ["an approved check after cd ..", "cd .. && npm run lint", false],
    ["an approved check chained with a writer", "npm run lint && npm install", false],
  ])("%s: %s", async (_name, command, runs) => {
    const verdict = await call("read-only", "bash", { command }, CHECKS);
    if (runs) {
      expect(verdict).toBeUndefined();
    } else {
      expect(verdict).toMatchObject({ block: true });
    }
  });

  it("names the checks in the prompt, and adds nothing without them", () => {
    expect(checksPrompt([])).toBe("");
    expect(checksPrompt(["npm test", "npm run lint"])).toContain("`npm test`, `npm run lint`");
    expect(checksPrompt(["npm test"])).toContain("a `cd` inside the project");
  });
});

describe("READ_ONLY_PROMPT", () => {
  it("names the tools to read with and the shapes bash refuses", () => {
    for (const tool of ["`read`", "`grep`", "`find`", "`ls`", "xargs"]) {
      expect(READ_ONLY_PROMPT).toContain(tool);
    }
  });
});
