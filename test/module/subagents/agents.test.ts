import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAgents, parseAgentFile } from "#module/subagents/agents";

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
    expect(trusted[0]?.description).toBe("Project");
    expect(untrusted[0]?.description).toBe("User");
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
