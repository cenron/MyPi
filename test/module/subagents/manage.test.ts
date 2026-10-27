import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentDefinition } from "#module/subagents/agents";
import { loadAgents } from "#module/subagents/agents";
import { agentManageRule, agentManageTool } from "#module/subagents/tools/manage";
import { fakeSession } from "../../fakes";

const builtinText = `---\nname: reviewer\ndescription: Reviews changes\naccess: read-only\nmodel: inherit\nthinking: inherit\n---\nReview.`;
const prompt = "Write tests from the provided spec.";
let folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
  folders = [];
  vi.unstubAllEnvs();
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "mypi-agent-manage-"));
  const home = join(root, "agent");
  const builtinDir = join(root, "builtins");
  await mkdir(builtinDir, { recursive: true });
  await writeFile(join(builtinDir, "reviewer.md"), builtinText);
  folders.push(root);
  vi.stubEnv("PI_CODING_AGENT_DIR", home);
  const fake = fakeSession([], root);
  let agents: AgentDefinition[] = [];
  const reload = vi.fn(() => {
    agents = loadAgents(builtinDir, root, true, vi.fn());
  });
  reload();
  const callbacks = {
    agents: () => agents,
    runtime: async () => ({}) as ModelRuntime,
    runtimeReady: () => ({}) as ModelRuntime,
    trusted: () => true,
    currentModel: (): Model<Api> | undefined => undefined,
    currentThinking: () => "high" as const,
    builtinNames: () => ["reviewer"],
    reload,
  };
  return { ...fake, root, builtinDir, callbacks, agents: callbacks.agents, reload };
}

describe("agent_manage confirmation", () => {
  it("asks with the whole definition and blocks deletion of a builtin", async () => {
    const { callbacks, root } = await setup();
    callbacks.currentModel = () => ({ provider: "openai", id: "gpt-6-luna", reasoning: true }) as Model<Api>;
    const rule = agentManageRule(callbacks, root);
    const confirm = rule(
      {
        toolName: "agent_manage",
        input: {
          action: "create",
          name: "tester",
          description: "Writes tests",
          prompt,
          access: "read-only",
          model: "inherit",
        },
      },
      { cwd: root, home: root, writableDirs: [], writableTools: new Set(), readableDirs: [] },
    );
    expect(confirm).toMatchObject({ kind: "ask", questions: [expect.stringContaining("description: Writes tests")] });
    expect(confirm).toMatchObject({ questions: [expect.stringContaining(`prompt: ${prompt}`)] });
    expect(confirm).toMatchObject({
      questions: [expect.stringContaining("model: inherit (current: openai/gpt-6-luna)")],
    });
    expect(
      rule(
        { toolName: "agent_manage", input: { action: "delete", name: "reviewer" } },
        { cwd: root, home: root, writableDirs: [], writableTools: new Set(), readableDirs: [] },
      ),
    ).toMatchObject({ kind: "block", reason: expect.stringContaining("can't be deleted") });
  });

  // Refused before the dialog, not after the user approved it.
  it("blocks a tool a subagent can't have before asking", async () => {
    const { callbacks, root } = await setup();
    const rule = agentManageRule(callbacks, root);
    const input = {
      action: "create",
      name: "tester",
      description: "Tests",
      prompt,
      tools: ["read", "lsp"],
      model: "inherit",
    };
    expect(
      rule(
        { toolName: "agent_manage", input },
        { cwd: root, home: root, writableDirs: [], writableTools: new Set(), readableDirs: [] },
      ),
    ).toMatchObject({ kind: "block", reason: expect.stringContaining("can't use lsp") });
  });
});

describe("agent_manage tool", () => {
  it("creates, edits, deletes, and reloads a user definition", async () => {
    const { callbacks, session, root, reload } = await setup();
    callbacks.currentModel = () => ({ provider: "openai", id: "gpt-6-luna", reasoning: true }) as Model<Api>;
    const tool = agentManageTool(session, callbacks);
    const call = (input: Record<string, unknown>) =>
      tool.execute("call", input as never, undefined, undefined, session.ctx as never);

    const created = await call({
      action: "create",
      name: "tester",
      description: "Writes tests",
      prompt,
      access: "read-only",
      model: "inherit",
      thinking: "inherit",
    });
    expect(created).toMatchObject({
      content: [{ text: expect.stringContaining("Model: inherit; thinking: high (requested inherit)") }],
    });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(callbacks.agents()).toMatchObject([
      { name: "reviewer", source: "builtin" },
      { name: "tester", source: "user", model: "inherit" },
    ]);

    await call({ action: "edit", name: "tester", description: "Tests from specs" });
    expect(callbacks.agents().find((agent) => agent.name === "tester")?.description).toBe("Tests from specs");
    expect(callbacks.agents().find((agent) => agent.name === "tester")?.prompt).toBe(prompt);

    await call({ action: "edit", name: "reviewer", description: "Use the current task" });
    expect(callbacks.agents().find((agent) => agent.name === "reviewer")?.source).toBe("user");
    const confirmDelete = agentManageRule(callbacks, root)(
      { toolName: "agent_manage", input: { action: "delete", name: "reviewer" } },
      { cwd: root, home: root, writableDirs: [], writableTools: new Set(), readableDirs: [] },
    );
    expect(confirmDelete).toMatchObject({
      kind: "ask",
      questions: [expect.stringContaining("The builtin will return.")],
    });
    await call({ action: "delete", name: "reviewer" });
    expect(callbacks.agents().find((agent) => agent.name === "reviewer")?.source).toBe("builtin");

    await call({ action: "delete", name: "tester" });
    expect(callbacks.agents().some((agent) => agent.name === "tester")).toBe(false);
    expect(reload).toHaveBeenCalledTimes(6);
  });

  it("refuses project scope in an untrusted project", async () => {
    const { callbacks, session } = await setup();
    const tool = agentManageTool(session, { ...callbacks, trusted: () => false });
    await expect(
      tool.execute(
        "call",
        { action: "create", name: "tester", description: "Tester", prompt, scope: "project" } as never,
        undefined,
        undefined,
        session.ctx as never,
      ),
    ).rejects.toThrow("untrusted project");
  });
});
