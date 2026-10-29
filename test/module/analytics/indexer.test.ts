import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MYPI_SESSION_MARKER_TYPE } from "#core/session-marker";
import { indexSessions } from "#module/analytics/indexer";
import { failureTotals, navigationTotals, shellTotals, toolTotals, usageTotals } from "#module/analytics/queries";
import { AnalyticsStore } from "#module/analytics/store";
import { call, result } from "./fakes";

const folders: string[] = [];
const HOME = "/home/user";
const header = `${JSON.stringify({
  type: "session",
  version: 3,
  id: "session-id",
  timestamp: "2026-10-26T10:00:00.000Z",
  cwd: "/project",
})}\n${JSON.stringify({ type: "custom", id: "marker", customType: MYPI_SESSION_MARKER_TYPE, data: {} })}`;

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-"));
  folders.push(folder);
  const source = join(folder, "sessions", "one.jsonl");
  await mkdir(join(folder, "sessions"), { recursive: true });
  const store = new AnalyticsStore(join(folder, "db", "analytics.sqlite"));
  return { folder, source, store };
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
  it("indexes legacy MyPi sessions with one of MyPi's tools in the first 16 lines", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(
      source,
      `${JSON.stringify(JSON.parse(header.split("\n")[0] ?? ""))}\n${call("legacy-lsp", "lsp", {})}\n`,
    );
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(toolTotals(store, {})).toEqual([{ tool: "lsp", calls: 1, failures: 0, exits: 0 }]);
    expect(store.skippedCount()).toBe(0);
    store.close();
  });

  it("skips other extension sessions without indexing later lines or rescanning them after growth", async () => {
    const { folder, source, store } = await fixture();
    // Started after MyPi began marking its sessions, so its first lines decide.
    const foreignHeader = JSON.stringify({
      ...JSON.parse(header.split("\n")[0] ?? ""),
      id: "foreign",
      timestamp: "2026-11-01T10:00:00.000Z",
    });
    const foreignLines = [
      foreignHeader,
      ...Array.from({ length: 16 }, (_, index) => JSON.stringify({ type: "unknown", index })),
    ];
    const hiddenMyPiCall = call("late-my-tool", "lsp", { action: "references" });
    await writeFile(source, `${foreignLines.join("\n")}\n${hiddenMyPiCall}\n`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(store.skippedCount()).toBe(1);
    expect(toolTotals(store, {})).toEqual([]);

    await writeFile(
      source,
      `${foreignLines.join("\n")}\n${hiddenMyPiCall}\n${reply("hidden", "2026-10-26T10:01:00.000Z")}\n`,
    );
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(store.skippedCount()).toBe(1);
    expect(toolTotals(store, {})).toEqual([]);
    expect(usageTotals(store, {})).toEqual([]);
    store.close();
  });

  it("ignores session roots that do not exist yet", async () => {
    const { folder, store } = await fixture();
    await expect(
      indexSessions([{ path: join(folder, "not-yet-created"), mypiOnly: false }], store, HOME),
    ).resolves.toBeUndefined();
    store.close();
  });

  it("indexes new lines once, resumes at its byte offset, and reindexes a shrunken file", async () => {
    const { folder, source, store } = await fixture();
    const first = `${reply("one", "2026-10-26T10:01:00.000Z")}\n`;
    await writeFile(source, `${header}\n${first}`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);

    await writeFile(source, `${header}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(2);

    const migratedHeader = header.replace("session-id", "session-new");
    await writeFile(source, `${migratedHeader}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(store.database.prepare("SELECT DISTINCT session_id AS id FROM usage").all()).toEqual([
      { id: "session-new" },
    ]);

    await writeFile(source, `${header}\n${first}`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);

    await writeFile(
      source,
      `${header}\n${first}${call("call-1", "bash", { command: "rg needle" })}\n${result("call-1", false, "ok")}\n`,
    );
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(toolTotals(store, {})).toEqual([{ tool: "bash", calls: 1, failures: 0, exits: 0 }]);

    await writeFile(source, `${header}\n${first}`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);
    expect(toolTotals(store, {})).toEqual([]);
    expect(shellTotals(store, {})).toEqual([]);
    store.close();
  });

  it("indexes tool calls and settles their results when the result line arrives", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(
      source,
      `${header}\n${call("call-1", "bash", { command: "rg -n needle src" })}\n${call("call-2", "read", { path: "a.ts" })}\n`,
    );
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(toolTotals(store, {})).toEqual([
      { tool: "bash", calls: 1, failures: 0, exits: 0 },
      { tool: "read", calls: 1, failures: 0, exits: 0 },
    ]);
    expect(shellTotals(store, {})).toEqual([{ name: "rg", calls: 1 }]);
    expect(navigationTotals(store, {})).toEqual([
      { provider: "openai", model: "gpt-6-luna", thinking: "high", lsp: 0, searches: 1, fromLineOne: 1 },
    ]);

    await writeFile(
      source,
      `${header}\n${call("call-1", "bash", { command: "rg -n needle src" })}\n` +
        `${call("call-2", "read", { path: "a.ts" })}\n` +
        `${call("call-3", "bash", { command: "ls /no/such/folder" })}\n` +
        `${result("call-1", true, "rg: no such file")}\n` +
        `${result("call-3", true, "ls: /no/such/folder: missing\n\nCommand exited with code 2")}\n`,
    );
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(toolTotals(store, {})).toEqual([
      { tool: "bash", calls: 2, failures: 1, exits: 1 },
      { tool: "read", calls: 1, failures: 0, exits: 0 },
    ]);
    expect(failureTotals(store, {})).toEqual([{ line: "rg: no such file", count: 1 }]);
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
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);

    expect(navigationTotals(store, {})).toEqual([
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
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);
    expect(toolTotals(store, {})).toHaveLength(1);

    await rm(source);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})).toEqual([]);
    expect(toolTotals(store, {})).toEqual([]);
    expect(shellTotals(store, {})).toEqual([]);
    store.close();
  });

  it("keeps concurrent indexing idempotent", async () => {
    const { folder, source, store } = await fixture();
    const otherWindow = new AnalyticsStore(join(folder, "db", "analytics.sqlite"));
    await writeFile(source, `${header}\n${reply("one", "2026-10-26T10:01:00.000Z")}\n`);

    await Promise.all([
      indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME),
      indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], otherWindow, HOME),
    ]);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);
    store.close();
    otherWindow.close();
  });

  it("waits for a partial final line, then indexes it when completed", async () => {
    const { folder, source, store } = await fixture();
    const pending = reply("one", "2026-10-26T10:01:00.000Z");
    await writeFile(source, `${header}\n${pending}`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})).toEqual([]);

    await writeFile(source, `${header}\n${pending}\n`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
    expect(usageTotals(store, {})[0]?.replies).toBe(1);
    store.close();
  });

  describe("sessions from before the marker", () => {
    const legacyHeader = JSON.stringify({ ...JSON.parse(header.split("\n")[0] ?? ""), id: "legacy" });
    const filler = Array.from({ length: 16 }, (_, index) => JSON.stringify({ type: "unknown", index }));

    it("are kept when they show MyPi anywhere, read in full once", async () => {
      const { folder, source, store } = await fixture();
      await writeFile(source, `${[legacyHeader, ...filler, call("late", "lsp", { action: "outline" })].join("\n")}\n`);
      await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
      expect(store.skippedCount()).toBe(0);
      expect(toolTotals(store, {})).toEqual([expect.objectContaining({ tool: "lsp" })]);
      store.close();
    });

    it("stay kept as they grow, without being judged again on their new lines", async () => {
      const { folder, source, store } = await fixture();
      const first = [legacyHeader, ...filler, call("late", "lsp", { action: "outline" })].join("\n");
      await writeFile(source, `${first}\n`);
      await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
      await writeFile(source, `${first}\n${call("next", "bash", { command: "ls" })}\n`);
      await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
      expect(store.skippedCount()).toBe(0);
      expect(
        toolTotals(store, {})
          .map(({ tool }) => tool)
          .sort(),
      ).toEqual(["bash", "lsp"]);
      store.close();
    });

    it("are skipped when nothing in them shows MyPi", async () => {
      const { folder, source, store } = await fixture();
      await writeFile(source, `${[legacyHeader, ...filler, call("late", "bash", { command: "ls" })].join("\n")}\n`);
      await indexSessions([{ path: join(folder, "sessions"), mypiOnly: false }], store, HOME);
      expect(store.skippedCount()).toBe(1);
      expect(toolTotals(store, {})).toEqual([]);
      store.close();
    });
  });

  it("keeps every session in a folder only MyPi writes, such as subagent runs", async () => {
    const { folder, source, store } = await fixture();
    const later = JSON.stringify({
      ...JSON.parse(header.split("\n")[0] ?? ""),
      id: "child",
      timestamp: "2026-11-01T10:00:00.000Z",
    });
    await writeFile(source, `${later}\n${call("c1", "read", { path: "a.ts" })}\n`);
    await indexSessions([{ path: join(folder, "sessions"), mypiOnly: true }], store, HOME);
    expect(store.skippedCount()).toBe(0);
    expect(toolTotals(store, {})).toEqual([expect.objectContaining({ tool: "read" })]);
    store.close();
  });
});
