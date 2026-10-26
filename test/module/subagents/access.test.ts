import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { childAccess } from "#module/subagents/access";
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

async function call(access: AgentDefinition["access"], toolName: string, input: Record<string, unknown>) {
  const fake = fakeSession();
  childAccess(agent(access))(fake.session.pi);
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
