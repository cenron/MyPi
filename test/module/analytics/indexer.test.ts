import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexSessions } from "#module/analytics/indexer";
import { AnalyticsStore } from "#module/analytics/store";

const folders: string[] = [];
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
    await expect(indexSessions([join(folder, "not-yet-created")], store)).resolves.toBeUndefined();
    store.close();
  });

  it("indexes new lines once, resumes at its byte offset, and reindexes a shrunken file", async () => {
    const { folder, source, store } = await fixture();
    const first = `${reply("one", "2026-10-26T10:01:00.000Z")}\n`;
    await writeFile(source, `${header}\n${first}`);
    await indexSessions([join(folder, "sessions")], store);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)[0]?.replies).toBe(1);

    await writeFile(source, `${header}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)[0]?.replies).toBe(2);

    const migratedHeader = header.replace("session-id", "session-new");
    await writeFile(source, `${migratedHeader}\n${first}${reply("two", "2026-10-26T10:02:00.000Z")}\n`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.database.prepare("SELECT DISTINCT session_id AS id FROM usage").all()).toEqual([
      { id: "session-new" },
    ]);

    await writeFile(source, `${header}\n${first}`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)[0]?.replies).toBe(1);
    store.close();
  });

  it("removes usage when its source transcript is deleted", async () => {
    const { folder, source, store } = await fixture();
    await writeFile(source, `${header}\n${reply("one", "2026-10-26T10:01:00.000Z")}\n`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)[0]?.replies).toBe(1);

    await rm(source);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)).toEqual([]);
    store.close();
  });

  it("keeps concurrent indexing idempotent", async () => {
    const { folder, source, store } = await fixture();
    const otherWindow = new AnalyticsStore(join(folder, "db", "analytics.sqlite"));
    await writeFile(source, `${header}\n${reply("one", "2026-10-26T10:01:00.000Z")}\n`);

    await Promise.all([
      indexSessions([join(folder, "sessions")], store),
      indexSessions([join(folder, "sessions")], otherWindow),
    ]);
    expect(store.totals(undefined)[0]?.replies).toBe(1);
    store.close();
    otherWindow.close();
  });

  it("waits for a partial final line, then indexes it when completed", async () => {
    const { folder, source, store } = await fixture();
    const pending = reply("one", "2026-10-26T10:01:00.000Z");
    await writeFile(source, `${header}\n${pending}`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)).toEqual([]);

    await writeFile(source, `${header}\n${pending}\n`);
    await indexSessions([join(folder, "sessions")], store);
    expect(store.totals(undefined)[0]?.replies).toBe(1);
    store.close();
  });
});
