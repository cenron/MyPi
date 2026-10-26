import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { checksPrompt, childAccess } from "#module/subagents/access";
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
  const CHECKS = ["npm run check"];

  it.each([
    ["an approved check, as written", "npm run check", true],
    ["an approved check with spaces around it", "  npm run check ", true],
    ["an approved check piped", "npm run check | tail -5", false],
    ["an approved check with more arguments", "npm run check -- --watch", false],
    ["a command that isn't approved", "npm test", false],
    ["a read-only command, as before", "ls", true],
  ])("runs %s: %s", async (_name, command, runs) => {
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
  });
});
