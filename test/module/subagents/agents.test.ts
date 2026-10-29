import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteAgent,
  loadAgents,
  parseAgentFile,
  projectAgentDir,
  saveAgent,
  userAgentDir,
  validateAgentName,
} from "#module/subagents/agents";

const valid = (name = "explore", extras = "") =>
  `---\nname: ${name}\ndescription: Search\naccess: read-only\n${extras}---\nPrompt`;
let folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
  folders = [];
  vi.unstubAllEnvs();
});

function tempFolder() {
  return mkdtemp(join(tmpdir(), "mypi-subagents-"));
}

describe("parseAgentFile", () => {
  it.each([
    ["missing required name", valid().replace("name: explore\n", ""), "missing or invalid field 'name'"],
    [
      "missing required description",
      valid().replace("description: Search\n", ""),
      "missing or invalid field 'description'",
    ],
    ["missing required access", valid().replace("access: read-only\n", ""), "missing or invalid field 'access'"],
    ["bad access", valid("explore", "model: inherit\n").replace("read-only", "admin"), "invalid field 'access'"],
    ["bad thinking", valid("explore", "thinking: impossible\n"), "invalid field 'thinking'"],
    ["a tool a child doesn't have", valid("explore", "tools: [read, lsp]\n"), "a subagent can't use lsp"],
  ])("rejects %s", (_label, source, error) => {
    expect(() => parseAgentFile("agent.md", source)).toThrow(`agent.md: ${error}`);
  });

  it("defaults model and thinking and parses tools", () => {
    expect(parseAgentFile("agent.md", valid("explore", "tools: [read, bash]\n"))).toMatchObject({
      model: "inherit",
      thinking: "inherit",
      tools: ["read", "bash"],
      prompt: "Prompt",
    });
  });
});

describe("builtin prompts", () => {
  const folder = fileURLToPath(new URL("../../../src/module/subagents/builtins/", import.meta.url));
  const names = ["architect", "developer", "explore", "general", "reviewer"];

  it("never names AGENTS.md, which the model would go looking for", async () => {
    for (const name of names) {
      expect(await readFile(join(folder, `${name}.md`), "utf8"), name).not.toContain("AGENTS.md");
    }
  });

  it("points general and developer at the project instructions in their context", async () => {
    for (const name of ["general", "developer"]) {
      expect(await readFile(join(folder, `${name}.md`), "utf8"), name).toContain(
        "project instructions in your context",
      );
    }
  });
});

describe("agent directories", () => {
  it("builds the user and project folders from their canonical roots", async () => {
    const root = await tempFolder();
    folders.push(root);
    vi.stubEnv("PI_CODING_AGENT_DIR", root);

    expect(userAgentDir()).toBe(join(root, "agents"));
    expect(projectAgentDir(root)).toBe(join(root, ".pi", "agents"));
  });
});

describe("loadAgents", () => {
  it("applies user overrides, then trusted project overrides", async () => {
    const builtin = await tempFolder();
    const agentDir = await tempFolder();
    const project = await tempFolder();
    folders.push(builtin, agentDir, project);
    await mkdir(join(agentDir, "agents"));
    await mkdir(join(project, ".pi", "agents"), { recursive: true });
    await writeFile(join(builtin, "explore.md"), valid("explore"));
    await writeFile(
      join(agentDir, "agents", "explore.md"),
      valid().replace("description: Search", "description: User"),
    );
    await writeFile(
      join(project, ".pi", "agents", "explore.md"),
      valid().replace("description: Search", "description: Project"),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    const trusted = loadAgents(builtin, project, true, vi.fn());
    const untrusted = loadAgents(builtin, project, false, vi.fn());
    expect(trusted[0]).toMatchObject({
      description: "Project",
      source: "project",
      path: join(project, ".pi", "agents", "explore.md"),
    });
    expect(untrusted[0]).toMatchObject({
      description: "User",
      source: "user",
      path: join(agentDir, "agents", "explore.md"),
    });
  });

  it("records builtin source and path", async () => {
    const builtin = await tempFolder();
    const agentDir = await tempFolder();
    folders.push(builtin, agentDir);
    await writeFile(join(builtin, "explore.md"), valid());
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    expect(loadAgents(builtin, "/project", false, vi.fn())[0]).toMatchObject({
      source: "builtin",
      path: join(builtin, "explore.md"),
    });
  });

  it("skips a bad user file and warns", async () => {
    const builtin = await tempFolder();
    const agentDir = await tempFolder();
    folders.push(builtin, agentDir);
    await mkdir(join(agentDir, "agents"));
    await writeFile(join(builtin, "explore.md"), valid());
    await writeFile(join(agentDir, "agents", "bad.md"), "---\nname: broken\n---\nPrompt");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const warn = vi.fn();

    expect(loadAgents(builtin, "/project", false, warn)).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("bad.md: missing or invalid field 'description'");
  });
});

const definition = {
  name: "tester",
  description: "Writes tests",
  access: "read-only" as const,
  tools: ["read", "bash"],
  model: "provider/model",
  thinking: "high" as const,
  prompt: "Use the spec.",
};

describe("agent persistence", () => {
  it.each([
    ["uppercase", "Tester"],
    ["spaces", "test agent"],
    ["underscore", "test_agent"],
    ["too long", "a".repeat(65)],
  ])("rejects %s names", (_label, name) => {
    expect(() => validateAgentName(name)).toThrow("Agent name must be");
  });

  it("writes definitions that parse back", async () => {
    const folder = await tempFolder();
    folders.push(folder);
    const path = saveAgent(definition, folder);
    const text = await readFile(path, "utf8");

    expect(text.indexOf("name:")).toBeLessThan(text.indexOf("description:"));
    expect(text.indexOf("description:")).toBeLessThan(text.indexOf("access:"));
    expect(text.indexOf("access:")).toBeLessThan(text.indexOf("tools:"));
    expect(text.indexOf("tools:")).toBeLessThan(text.indexOf("model:"));
    expect(text.indexOf("model:")).toBeLessThan(text.indexOf("thinking:"));
    expect(parseAgentFile(path, text)).toMatchObject(definition);
  });

  it("refuses a serialized definition that would not parse", async () => {
    const folder = await tempFolder();
    folders.push(folder);

    expect(() => saveAgent({ ...definition, description: "" }, folder)).toThrow("invalid field 'description'");
    expect(existsSync(join(folder, "tester.md"))).toBe(false);
  });

  it("refuses deleting a builtin and removes a user override", async () => {
    const folder = await tempFolder();
    folders.push(folder);
    const path = saveAgent(definition, folder);
    const user = { ...definition, source: "user" as const, path };

    expect(() => deleteAgent({ ...user, source: "builtin" })).toThrow("can't be deleted");
    deleteAgent(user);
    expect(existsSync(path)).toBe(false);
  });
});
