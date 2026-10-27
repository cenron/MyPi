import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DONE_CHECK_NOTICE } from "#core/job-notice";
import { MYPI_SESSION_MARKER_TYPE } from "#core/session-marker";
import { AnalyticsModule } from "#module/analytics/index";
import { usageTotals } from "#module/analytics/queries";
import { AnalyticsStore } from "#module/analytics/store";
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
  const call = {
    type: "message",
    id: `call-${id}`,
    parentId: `usage-${id}`,
    timestamp,
    message: {
      role: "assistant",
      provider: "openai",
      model,
      thinkingLevel: "high",
      content: [
        { type: "toolCall", id: `bash-${id}`, name: "bash", arguments: { command: `rg needle ${id}` } },
        { type: "toolCall", id: `lsp-${id}`, name: "lsp", arguments: { action: "references" } },
      ],
    },
  };
  const results = [
    {
      type: "message",
      id: `bash-result-${id}`,
      parentId: `call-${id}`,
      timestamp,
      message: {
        role: "toolResult",
        toolCallId: `bash-${id}`,
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: `failed ${id}` }],
      },
    },
    {
      type: "message",
      id: `lsp-result-${id}`,
      parentId: `call-${id}`,
      timestamp,
      message: {
        role: "toolResult",
        toolCallId: `lsp-${id}`,
        toolName: "lsp",
        isError: false,
        content: [{ type: "text", text: "ok" }],
      },
    },
  ];
  return (
    `${JSON.stringify(header)}\n${JSON.stringify(reply)}\n${JSON.stringify(usage)}\n${JSON.stringify(call)}\n` +
    `${JSON.stringify(results[0])}\n${JSON.stringify(results[1])}\n`
  );
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
    expect(report).toContain("openai/gpt-6-luna · high      1 reply · in 100 · out 20 · cache 33% · $0.01");
    expect(report).toContain("openai/gpt-6-luna · unknown   0 replies · in 50 · out 0 · cache 33% · $0.01");
    expect(report).toContain("Tools\nbash 1 call · 100% failed\nlsp  1 call · 0% failed");
    expect(report).toContain("Top failure lines\n   1  failed recent");
    expect(report).toContain("Shell commands with no tool\nrg 1 call");
    expect(report).toContain(
      "Code navigation\nopenai/gpt-6-luna · high   1 lsp · 1 code search · 0 reads from line 1 · lsp share 50%",
    );
    expect(report).not.toContain("gpt-5");
    expect(report).not.toContain("failed old");
    expect(allHistory).toContain("Model usage · all history");
    expect(allHistory).toContain("openai/gpt-5 · high           1 reply");
    expect(allHistory).toContain("failed old");
  });

  it("reports feature counts and attributes child cost to the parent call", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "mypi-analytics-features-"));
    folders.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const mainRoot = join(agentDir, "sessions", "project");
    const childRoot = join(agentDir, "subagents", "sessions");
    await mkdir(mainRoot, { recursive: true });
    await mkdir(childRoot, { recursive: true });
    const parentPath = join(mainRoot, "parent.jsonl");
    const timestamp = new Date().toISOString();
    const parent = `${[
      { type: "session", version: 3, id: "parent", timestamp, cwd: "/project" },
      {
        type: "message",
        id: "task",
        timestamp,
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-6-luna",
          thinkingLevel: "high",
          content: [{ type: "toolCall", id: "task-call", name: "task_create", arguments: {} }],
        },
      },
      {
        type: "message",
        id: "child-call",
        timestamp,
        message: {
          role: "assistant",
          provider: "openai",
          model: "gpt-6-luna",
          thinkingLevel: "high",
          content: [{ type: "toolCall", id: "sub-call", name: "subagent", arguments: { agent: "reviewer" } }],
        },
      },
      {
        type: "usage",
        id: "usage-old-model",
        timestamp,
        provider: "openai",
        model: "gpt-5",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
      {
        type: "usage",
        id: "usage-current-model",
        timestamp,
        provider: "openai",
        model: "gpt-6-luna",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
      },
      {
        type: "custom_message",
        id: "notice-report",
        timestamp,
        customType: DONE_CHECK_NOTICE,
        content: "Done check: an error",
      },
      {
        type: "custom_message",
        id: "notice-pass",
        timestamp,
        customType: DONE_CHECK_NOTICE,
        content: "Done check passed: tsc passed.",
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n")}\n`;
    await writeFile(parentPath, parent);
    await writeFile(
      join(childRoot, "child.jsonl"),
      `${[
        { type: "session", version: 3, id: "child", timestamp, cwd: "/project", parentSession: parentPath },
        { type: "custom", id: "marker", customType: MYPI_SESSION_MARKER_TYPE, data: {} },
        {
          type: "message",
          id: "reply",
          timestamp,
          message: {
            role: "assistant",
            provider: "openai",
            model: "gpt-6-luna",
            thinkingLevel: "high",
            usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.42 } },
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );

    const fake = fakeSession();
    const module = new AnalyticsModule(fake.session);
    module.init();
    const report = await module.commands()[0]?.execute({} as never, ["all"]);
    await fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
    expect(report).toContain("1 task-tool run · 1 call");
    expect(report).toContain("openai/gpt-6-luna · unknown   1 done-check report · 1 pass");
    expect(report).not.toContain("gpt-5 · unknown   1 done-check report");
    expect(report).toContain("reviewer · openai/gpt-6-luna · high   1 run · $0.42 child cost");
  });

  it("attributes a same-timestamp notice only to usage earlier in the transcript", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "mypi-analytics-order-"));
    folders.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const sessions = join(agentDir, "sessions", "project");
    await mkdir(sessions, { recursive: true });
    const timestamp = new Date().toISOString();
    const usage = (id: string, model: string) => ({
      type: "usage",
      id,
      timestamp,
      provider: "openai",
      model,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } },
    });
    const entries = [
      { type: "session", version: 3, id: "ordered", timestamp, cwd: "/project" },
      { type: "custom", id: "marker", customType: MYPI_SESSION_MARKER_TYPE, data: {} },
      usage("before", "earlier-model"),
      { type: "custom_message", id: "notice", timestamp, customType: DONE_CHECK_NOTICE, content: "Done check: error" },
      usage("after", "later-model"),
    ];
    await writeFile(join(sessions, "ordered.jsonl"), `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

    const fake = fakeSession();
    const module = new AnalyticsModule(fake.session);
    module.init();
    const report = await module.commands()[0]?.execute({} as never, ["all"]);
    await fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(report).toContain("earlier-model · unknown   1 done-check report · 0 passes");
    expect(report).not.toContain("later-model · unknown   1 done-check report");
  });

  it("waits for a running index before closing the store", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "mypi-analytics-module-"));
    folders.push(agentDir);
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const sessions = join(agentDir, "sessions", "project");
    await mkdir(sessions, { recursive: true });
    const recent = new Date().toISOString();
    await writeFile(join(sessions, "recent.jsonl"), sessionFile("recent", recent, "gpt-6-luna", 100));

    const fake = fakeSession();
    const module = new AnalyticsModule(fake.session);
    module.init();
    await Promise.resolve();
    await fake.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });

    const store = new AnalyticsStore(join(agentDir, "analytics", "analytics.sqlite"));
    expect(usageTotals(store, undefined)).toHaveLength(2);
    store.close();
  });

  it("warns and reports when the store cannot be opened", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-module-"));
    folders.push(folder);
    const agentFile = join(folder, "agent-dir");
    await writeFile(agentFile, "");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentFile);

    const fake = fakeSession();
    const module = new AnalyticsModule(fake.session);
    module.init();
    await vi.waitFor(() =>
      expect(fake.notify).toHaveBeenCalledWith(expect.stringContaining("Analytics indexing failed"), "warning"),
    );

    const report = await module.commands()[0]?.execute({} as never, []);
    expect(report).toMatch(/Analytics indexing failed/);
  });
});
