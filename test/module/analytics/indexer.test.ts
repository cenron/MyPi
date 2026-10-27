import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexSessions } from "#module/analytics/indexer";
import { failureTotals, navigationTotals, shellTotals, toolTotals, usageTotals } from "#module/analytics/queries";
import { AnalyticsStore } from "#module/analytics/store";

const folders: string[] = [];
const HOME = "/home/user";
const header = JSON.stringify({
  type: "session",
  version: 3,
  id: "session-id",
  timestamp: "2026-10-26T10:00:00.000Z",
  cwd: "/project",
});

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-"));
  folders.push(folder);
  const source = join(folder, "sessions", "one.jsonl");
  await mkdir(join(folder, "sessions"), { recursive: true });
  const store = new AnalyticsStore(join(folder, "db", "analytics.sqlite"));
  return { folder, source, store };
}

function call(id: string, name: string, args: Record<string, unknown>) {
  return JSON.stringify({
    type: "message",
    id: `message-${id}`,
    parentId: null,
    timestamp: "2026-10-26T10:03:00.000Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-6-luna",
      thinkingLevel: "high",
      content: [{ type: "toolCall", id, name, arguments: args }],
    },
  });
}

function result(id: string, isError: boolean, text: string) {
  return JSON.stringify({
    type: "message",
    id: `result-${id}`,
    parentId: `message-${id}`,
    timestamp: "2026-10-26T10:03:01.000Z",
    message: { role: "toolResult", toolCallId: id, toolName: "bash", isError, content: [{ type: "text", text }] },
  });
}

function reply(id: string, timestamp: string) {
  return JSON.stringify({
    type: "message",
    id,
    parentId: null,
    timestamp,
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-6-luna",
      thinkingLevel: "high",
      stopReason: "stop",
      usage: {
        input: 10,
        output: 2,
        cacheRead: 4,
        cacheWrite: 1,
        cost: { total: 0.001 },
      },
    },
  });
}

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("indexSessions", () => {
  it("ignores session roots that do not exist yet", async () => {
    const { folder, store } = await fixture();
    await expect(indexSessions([join(folder, "not-yet-created")], store, HOME)).resolves.toBeUndefined();
    store.close();
  });

  it("indexes new lines once, resumes at its byte offset, and reindexes a shrunken file", async () => {
    const { folder, source, store } = await fixture();
    const first = `${reply("one", "2026-10-26T10:01:00.000Z")}\n`;
    await writeFile(source, `${header}\n${first}`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);

    await writeFile(source, `${header}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(2);

    const migratedHeader = header.replace("session-id", "session-new");
    await writeFile(source, `${migratedHeader}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(store.database.prepare("SELECT DISTINCT session_id AS id FROM usage").all()).toEqual([
      { id: "session-new" },
    ]);

    await writeFile(source, `${header}\n${first}`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);

    await writeFile(
      source,
      `${header}\n${first}${call("call-1", "bash", { command: "rg needle" })}\n${result("call-1", false, "ok")}\n`,
    );
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(toolTotals(store, undefined)).toEqual([{ tool: "bash", calls: 1, failures: 0 }]);

    await writeFile(source, `${header}\n${first}`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);
    expect(toolTotals(store, undefined)).toEqual([]);
    expect(shellTotals(store, undefined)).toEqual([]);
    store.close();
  });

  it("indexes tool calls and settles their results when the result line arrives", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(
      source,
      `${header}\n${call("call-1", "bash", { command: "rg -n needle src" })}\n${call("call-2", "read", { path: "a.ts" })}\n`,
    );
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(toolTotals(store, undefined)).toEqual([
      { tool: "bash", calls: 1, failures: 0 },
      { tool: "read", calls: 1, failures: 0 },
    ]);
    expect(shellTotals(store, undefined)).toEqual([{ name: "rg", calls: 1 }]);
    expect(navigationTotals(store, undefined)).toEqual([
      { provider: "openai", model: "gpt-6-luna", thinking: "high", lsp: 0, searches: 1, fromLineOne: 1 },
    ]);

    await writeFile(
      source,
      `${header}\n${call("call-1", "bash", { command: "rg -n needle src" })}\n` +
        `${call("call-2", "read", { path: "a.ts" })}\n${result("call-1", true, "rg: no such file")}\n`,
    );
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(toolTotals(store, undefined)).toEqual([
      { tool: "bash", calls: 1, failures: 1 },
      { tool: "read", calls: 1, failures: 0 },
    ]);
    expect(failureTotals(store, undefined)).toEqual([{ line: "rg: no such file", count: 1 }]);
    store.close();
  });

  it("counts lsp calls, grep and find tools, and later read parts in the navigation query", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(
      source,
      `${header}\n${call("call-1", "lsp", { action: "references" })}\n` +
        `${call("call-2", "grep", { pattern: "needle" })}\n${call("call-3", "find", { glob: "*.ts" })}\n` +
        `${call("call-4", "read", { path: "a.ts", offset: 40 })}\n` +
        `${call("call-5", "bash", { command: "rg needle src" })}\n` +
        `${call("call-6", "bash", { command: "rg needle node_modules" })}\n`,
    );
    await indexSessions([join(folder, "sessions")], store, HOME);

    expect(navigationTotals(store, undefined)).toEqual([
      { provider: "openai", model: "gpt-6-luna", thinking: "high", lsp: 1, searches: 3, fromLineOne: 0 },
    ]);
    store.close();
  });

  it("removes usage when its source transcript is deleted", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(
      source,
      `${header}\n${reply("one", "2026-10-26T10:01:00.000Z")}\n` +
        `${call("call-1", "bash", { command: "rg needle" })}\n${result("call-1", false, "ok")}\n`,
    );
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);
    expect(toolTotals(store, undefined)).toHaveLength(1);

    await rm(source);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)).toEqual([]);
    expect(toolTotals(store, undefined)).toEqual([]);
    expect(shellTotals(store, undefined)).toEqual([]);
    store.close();
  });

  it("keeps concurrent indexing idempotent", async () => {
    const { folder, source, store } = await fixture();
    const otherWindow = new AnalyticsStore(join(folder, "db", "analytics.sqlite"));
    await writeFile(source, `${header}\n${reply("one", "2026-10-26T10:01:00.000Z")}\n`);

    await Promise.all([
      indexSessions([join(folder, "sessions")], store, HOME),
      indexSessions([join(folder, "sessions")], otherWindow, HOME),
    ]);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);
    store.close();
    otherWindow.close();
  });

  it("waits for a partial final line, then indexes it when completed", async () => {
    const { folder, source, store } = await fixture();
    const pending = reply("one", "2026-10-26T10:01:00.000Z");
    await writeFile(source, `${header}\n${pending}`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)).toEqual([]);

    await writeFile(source, `${header}\n${pending}\n`);
    await indexSessions([join(folder, "sessions")], store, HOME);
    expect(usageTotals(store, undefined)[0]?.replies).toBe(1);
    store.close();
  });
});
