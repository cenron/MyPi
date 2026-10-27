import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openSQLite, withTransaction } from "#module/analytics/sqlite";

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

describe("SQLite utilities", () => {
  it("opens nested databases with WAL and a busy timeout", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-sqlite-"));
    folders.push(folder);
    const database = openSQLite(join(folder, "nested", "analytics.sqlite"));

    expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
    expect(database.prepare("PRAGMA busy_timeout").get()).toMatchObject({ timeout: 5000 });
    database.close();
  });

  it("commits successful operations and rolls back failures", async () => {
    const folder = await mkdtemp(join(tmpdir(), "mypi-analytics-sqlite-"));
    folders.push(folder);
    const database = openSQLite(join(folder, "analytics.sqlite"));
    database.exec("CREATE TABLE entries (value TEXT NOT NULL)");

    expect(() =>
      withTransaction(database, () => {
        database.prepare("INSERT INTO entries(value) VALUES (?)").run("rolled back");
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(
      withTransaction(database, () => database.prepare("INSERT INTO entries(value) VALUES (?)").run("saved")),
    ).toBeDefined();
    expect(database.prepare("SELECT value FROM entries").all()).toEqual([{ value: "saved" }]);
    database.close();
  });
});
