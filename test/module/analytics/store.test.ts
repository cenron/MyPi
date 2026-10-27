import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { usageTotals } from "#module/analytics/queries";
import { AnalyticsStore } from "#module/analytics/store";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("AnalyticsStore", () => {
  it("rebuilds an older schema for reindexing from session files", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-store-"));
    folders.push(folder);
    const path = join(folder, "analytics.sqlite");
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL);
      INSERT INTO schema_version(version) VALUES (0);
      CREATE TABLE files (old_layout TEXT);
      CREATE TABLE usage (old_layout TEXT);
      CREATE TABLE tool_calls (old_layout TEXT);
      CREATE TABLE shell_commands (old_layout TEXT);`);
    old.close();

    const store = new AnalyticsStore(path);
    const version = store.database.prepare("SELECT version FROM schema_version").get() as { version: number };
    const columns = store.database.prepare("PRAGMA table_info(usage)").all() as { name: string }[];

    expect(version.version).toBe(5);
    expect(columns.map(({ name }) => name)).toContain("entry_id");
    expect(usageTotals(store, undefined)).toEqual([]);
    store.close();
  });
});
