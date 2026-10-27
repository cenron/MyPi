import type { DatabaseSync } from "node:sqlite";
import type { SessionHeader, ToolCallRow, ToolResultRow, UsageRow } from "./entries";
import { ensureSchemaVersion, openSQLite, withTransaction } from "./sqlite";

const SCHEMA_VERSION = 5;

/** A transcript's indexed position and its session metadata. */
export type AnalyticsFile = {
  path: string;
  header: SessionHeader;
  size: number;
  offset: number;
};

/** The rows one indexed chunk of a transcript holds. */
export type FileRows = {
  usage: UsageRow[];
  calls: ToolCallRow[];
  results: ToolResultRow[];
};

/** Local SQLite store for indexed transcript usage. */
export class AnalyticsStore {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = openSQLite(path);
    ensureSchemaVersion(this.database, SCHEMA_VERSION, () => {
      this.database.exec(`DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS tool_calls; DROP TABLE IF EXISTS shell_commands;
        CREATE TABLE files (
          file_path TEXT PRIMARY KEY, size INTEGER NOT NULL, offset INTEGER NOT NULL, session_id TEXT NOT NULL
        );
        CREATE TABLE usage (
          file_path TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, entry_id TEXT NOT NULL,
          is_reply INTEGER NOT NULL, timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
          thinking TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
          cache_write INTEGER NOT NULL, cost REAL NOT NULL, stop_reason TEXT NOT NULL,
          PRIMARY KEY(file_path, entry_id)
        );
        CREATE TABLE tool_calls (
          file_path TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, call_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, thinking TEXT NOT NULL,
          tool TEXT NOT NULL, code_search INTEGER NOT NULL, from_line_one INTEGER NOT NULL, failed INTEGER,
          failure_line TEXT,
          PRIMARY KEY(file_path, call_id)
        );
        CREATE TABLE shell_commands (
          file_path TEXT NOT NULL, call_id TEXT NOT NULL, name TEXT NOT NULL, timestamp INTEGER NOT NULL,
          PRIMARY KEY(file_path, call_id, name)
        );`);
    });
  }

  /** Replaces a transcript's rows and progress after a reset or reindex. */
  replaceFile(file: AnalyticsFile, rows: FileRows): void {
    withTransaction(this.database, () => {
      this.database.prepare("DELETE FROM usage WHERE file_path = ?").run(file.path);
      this.database.prepare("DELETE FROM tool_calls WHERE file_path = ?").run(file.path);
      this.database.prepare("DELETE FROM shell_commands WHERE file_path = ?").run(file.path);
      this.insertRows(file, rows);
      this.saveProgress(file);
    });
  }

  /** Appends newly parsed rows and advances the transcript's progress. */
  appendFile(file: AnalyticsFile, rows: FileRows): void {
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
        this.database.prepare("DELETE FROM tool_calls WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM shell_commands WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM files WHERE file_path = ?").run(path);
      }
    });
  }

  close(): void {
    this.database.close();
  }

  private insertRows(file: AnalyticsFile, rows: FileRows): void {
    const insertUsage = this.database.prepare(
      `INSERT OR IGNORE INTO usage(file_path, session_id, cwd, entry_id, is_reply, timestamp, provider, model,
        thinking, input, output, cache_read, cache_write, cost, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows.usage) {
      insertUsage.run(
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

    const insertCall = this.database.prepare(
      `INSERT OR IGNORE INTO tool_calls(file_path, session_id, cwd, call_id, timestamp, provider, model, thinking,
        tool, code_search, from_line_one)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertCommand = this.database.prepare(
      "INSERT OR IGNORE INTO shell_commands(file_path, call_id, name, timestamp) VALUES (?, ?, ?, ?)",
    );
    for (const call of rows.calls) {
      insertCall.run(
        file.path,
        file.header.id,
        file.header.cwd,
        call.callId,
        call.timestamp,
        call.provider,
        call.model,
        call.thinking,
        call.tool,
        call.codeSearch ? 1 : 0,
        call.fromLineOne ? 1 : 0,
      );
      for (const name of call.commandNames) {
        insertCommand.run(file.path, call.callId, name, call.timestamp);
      }
    }

    const settleCall = this.database.prepare(
      "UPDATE tool_calls SET failed = ?, failure_line = ? WHERE file_path = ? AND call_id = ?",
    );
    for (const result of rows.results) {
      settleCall.run(result.failed ? 1 : 0, result.failureLine ?? null, file.path, result.callId);
    }
  }

  private saveProgress(file: AnalyticsFile): void {
    this.database
      .prepare("INSERT OR REPLACE INTO files(file_path, size, offset, session_id) VALUES (?, ?, ?, ?)")
      .run(file.path, file.size, file.offset, file.header.id);
  }
}
