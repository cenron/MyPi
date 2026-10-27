import type { DatabaseSync } from "node:sqlite";
import type { SessionHeader, UsageRow } from "./entries";
import { ensureSchemaVersion, openSQLite, withTransaction } from "./sqlite";

const SCHEMA_VERSION = 2;

/** A transcript's indexed position and its session metadata. */
export type AnalyticsFile = {
  path: string;
  header: SessionHeader;
  size: number;
  offset: number;
};

/** Aggregated usage in one provider, model, and thinking-level group. */
export type UsageTotals = {
  provider: string;
  model: string;
  thinking: string;
  replies: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
};

/** Local SQLite store for indexed transcript usage. */
export class AnalyticsStore {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = openSQLite(path);
    ensureSchemaVersion(this.database, SCHEMA_VERSION, () => {
      this.database.exec(`DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS files;
        CREATE TABLE files (
          file_path TEXT PRIMARY KEY, size INTEGER NOT NULL, offset INTEGER NOT NULL, session_id TEXT NOT NULL
        );
        CREATE TABLE usage (
          file_path TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, entry_id TEXT NOT NULL,
          is_reply INTEGER NOT NULL, timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
          thinking TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
          cache_write INTEGER NOT NULL, cost REAL NOT NULL, stop_reason TEXT NOT NULL,
          PRIMARY KEY(file_path, entry_id)
        );`);
    });
  }

  /** Replaces a transcript's rows and progress after a reset or reindex. */
  replaceFile(file: AnalyticsFile, rows: readonly UsageRow[]): void {
    withTransaction(this.database, () => {
      this.database.prepare("DELETE FROM usage WHERE file_path = ?").run(file.path);
      this.insertRows(file, rows);
      this.saveProgress(file);
    });
  }

  /** Appends newly parsed rows and advances the transcript's progress. */
  appendRows(file: AnalyticsFile, rows: readonly UsageRow[]): void {
    withTransaction(this.database, () => {
      this.insertRows(file, rows);
      this.saveProgress(file);
    });
  }

  /** Indexed byte offset and size for a transcript, or undefined when not indexed. */
  fileProgress(path: string): { size: number; offset: number; sessionId: string } | undefined {
    return this.database
      .prepare("SELECT size, offset, session_id AS sessionId FROM files WHERE file_path = ?")
      .get(path) as { size: number; offset: number; sessionId: string } | undefined;
  }

  /** Paths of the indexed transcripts, so the indexer can remove source files that disappeared. */
  filePaths(): string[] {
    return (this.database.prepare("SELECT file_path FROM files").all() as { file_path: string }[]).map(
      ({ file_path }) => file_path,
    );
  }

  /** Removes transcripts whose source files are confirmed to be gone. */
  removeFiles(paths: readonly string[]): void {
    if (paths.length === 0) return;

    withTransaction(this.database, () => {
      for (const path of paths) {
        this.database.prepare("DELETE FROM usage WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM files WHERE file_path = ?").run(path);
      }
    });
  }

  /** Usage totals grouped by provider, model, and thinking level since a timestamp. */
  totals(since: number | undefined): UsageTotals[] {
    return this.database
      .prepare(
        `SELECT provider, model, thinking, SUM(is_reply) AS replies, SUM(input) AS input, SUM(output) AS output,
          SUM(cache_read) AS cacheRead, SUM(cache_write) AS cacheWrite, SUM(cost) AS cost
         FROM usage ${since === undefined ? "" : "WHERE timestamp >= ?"}
         GROUP BY provider, model, thinking ORDER BY provider, model, thinking`,
      )
      .all(...(since === undefined ? [] : [since])) as UsageTotals[];
  }

  close(): void {
    this.database.close();
  }

  private insertRows(file: AnalyticsFile, rows: readonly UsageRow[]): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO usage(file_path, session_id, cwd, entry_id, is_reply, timestamp, provider, model,
        thinking, input, output, cache_read, cache_write, cost, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        file.path,
        file.header.id,
        file.header.cwd,
        row.entryId,
        row.isReply ? 1 : 0,
        row.timestamp,
        row.provider,
        row.model,
        row.thinking,
        row.input,
        row.output,
        row.cacheRead,
        row.cacheWrite,
        row.cost,
        row.stopReason,
      );
    }
  }

  private saveProgress(file: AnalyticsFile): void {
    this.database
      .prepare("INSERT OR REPLACE INTO files(file_path, size, offset, session_id) VALUES (?, ?, ?, ?)")
      .run(file.path, file.size, file.offset, file.header.id);
  }
}
