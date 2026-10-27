import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnalyticsModule } from "#module/analytics/index";
import { fakeSession } from "../../fakes";

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function sessionFile(id: string, timestamp: string, model: string, input: number) {
  const header = {
    type: "session",
    version: 3,
    id: `session-${id}`,
    timestamp,
    cwd: "/project",
  };
  const reply = {
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      provider: "openai",
      model,
      thinkingLevel: "high",
      stopReason: "stop",
      usage: {
        input,
        output: 20,
        cacheRead: 50,
        cacheWrite: 10,
        cost: { total: 0.01 },
      },
    },
  };
  const usage = {
    type: "usage",
    id: `usage-${id}`,
    parentId: id,
    timestamp,
    kind: "cache_warm",
    provider: "openai",
    model,
    usage: {
      input: 50,
      output: 0,
      cacheRead: 25,
      cacheWrite: 0,
      cost: { total: 0.005 },
    },
  };
  return `${JSON.stringify(header)}\n${JSON.stringify(reply)}\n${JSON.stringify(usage)}\n`;
}

describe("AnalyticsModule", () => {
  it("reports recent usage by model and thinking level, or all history", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "mypi-analytics-module-"));
    folders.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
    const mainSessions = join(agentDir, "sessions", "project");
    const subagentSessions = join(agentDir, "subagents", "sessions");
    await mkdir(mainSessions, { recursive: true });
    await mkdir(subagentSessions, { recursive: true });
    await writeFile(join(mainSessions, "recent.jsonl"), sessionFile("recent", recent, "gpt-6-luna", 100));
    await writeFile(join(subagentSessions, "old.jsonl"), sessionFile("old", old, "gpt-5", 200));

    const fake = fakeSession();
    const module = new AnalyticsModule(fake.session);
    module.init();
    const command = module.commands()[0];
    expect(module.info.commands[0]).toBe(command?.info);
    const report = await command?.execute({} as never, []);
    const allHistory = await command?.execute({} as never, ["all"]);
    await fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(report).toContain("Model usage · last 7 days");
    expect(report).toContain("openai/gpt-6-luna · high   1 replies · in 100 · out 20 · cache 33% · $0.01");
    expect(report).toContain("openai/gpt-6-luna · unknown   0 replies · in 50 · out 0 · cache 33% · $0.01");
    expect(report).not.toContain("gpt-5");
    expect(allHistory).toContain("Model usage · all history");
    expect(allHistory).toContain("openai/gpt-5 · high   1 replies");
  });
});
