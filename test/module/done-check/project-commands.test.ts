import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approve, isApproved, readCommands, runCommand } from "#module/done-check/project-commands";

let project: string;
let agentDir: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "mypi-done-project-"));
  agentDir = await mkdtemp(join(tmpdir(), "mypi-done-agent-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
});

const listCommands = async (text: string) => {
  await mkdir(join(project, ".pi"), { recursive: true });
  await writeFile(join(project, ".pi/done-check.json"), text);
};

describe("readCommands", () => {
  it("reads the project's list, and is undefined without the file", async () => {
    expect(await readCommands(project)).toBeUndefined();
    await listCommands('{ "commands": ["npm test", "npm run lint"] }');
    expect(await readCommands(project)).toEqual(["npm test", "npm run lint"]);
  });

  it.each([
    ["isn't JSON", "commands: npm test"],
    ["isn't a list of strings", '{ "commands": "npm test" }'],
  ])("fails, saying what the file should hold, when it %s", async (_case, text) => {
    await listCommands(text);
    await expect(readCommands(project)).rejects.toThrow(
      '.pi/done-check.json must hold { "commands": ["npm test", …] }',
    );
  });
});

describe("approvals", () => {
  it("hold for exactly the approved list, in that project only", async () => {
    expect(await isApproved(project, ["npm test"])).toBe(false);
    await approve(project, ["npm test"]);

    expect(await isApproved(project, ["npm test"])).toBe(true);
    expect(await isApproved(project, ["npm test", "rm -rf ~"])).toBe(false);
    expect(await isApproved("/elsewhere", ["npm test"])).toBe(false);
  });

  // A repo must never arrive approved: the approval lives in the agent dir, not the project.
  it("are kept in the agent dir, never in the project", async () => {
    await approve(project, ["npm test"]);
    expect(await readdir(join(agentDir, "done-check"))).toEqual(["approved.json"]);
    expect(await readdir(project)).toEqual([]);
  });
});

describe("runCommand", () => {
  it("is undefined for a command that passes", async () => {
    expect(await runCommand("true", project)).toBeUndefined();
  });

  it("gives a failing command's exit code and the end of its output", async () => {
    expect(await runCommand("echo checking; echo 'FAIL a.test.ts' >&2; exit 3", project)).toEqual({
      command: "echo checking; echo 'FAIL a.test.ts' >&2; exit 3",
      ended: { kind: "exit", code: 3 },
      output: "checking\nFAIL a.test.ts",
    });
  });

  it("says when a command couldn't run", async () => {
    expect(await runCommand("true", join(project, "missing"))).toMatchObject({
      ended: { kind: "error", message: expect.stringContaining("Working directory does not exist") },
    });
  });

  it("throws on an abort, so the check stops", async () => {
    const controller = new AbortController();
    const running = runCommand("sleep 5", project, controller.signal);
    controller.abort();
    await expect(running).rejects.toThrow();
  });
});
