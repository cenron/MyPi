import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commandsStatus } from "#module/done-check/commands/done-check";
import { approvalKey, approve } from "#module/done-check/project-commands";

let project: string;
let agentDir: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "mypi-done-status-"));
  agentDir = await mkdtemp(join(tmpdir(), "mypi-done-agent-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
  await rm(agentDir, { recursive: true, force: true });
});

it("says how to list commands, then lists them, not approved and then approved", async () => {
  expect(await commandsStatus(project)).toBe(
    'Done check: no commands. List them in .pi/done-check.json as { "commands": ["npm test"] }.',
  );

  await mkdir(join(project, ".pi"));
  await writeFile(join(project, ".pi/done-check.json"), '{ "commands": ["npm test"] }');
  expect(await commandsStatus(project)).toBe(
    "Done check commands in .pi/done-check.json (not approved yet: you're asked at the end of the next Build run " +
      "that changes files):\n  npm test",
  );

  await approve(await approvalKey(undefined, project), ["npm test"]);
  expect(await commandsStatus(project)).toBe("Done check commands in .pi/done-check.json (approved):\n  npm test");
  const repository = { main: project, commonDir: join(project, ".git"), checkout: project };
  expect(await commandsStatus(project, repository)).toContain("not approved yet");
  await approve(await approvalKey(repository, project), ["npm test"]);
  expect(await commandsStatus(project, repository)).toContain("(approved)");
});
