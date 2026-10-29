import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Approval } from "#core/channels";
import type { FeatureRow, SessionHeader, ToolCallRow, ToolResultRow, UsageRow } from "./entries";
import { ensureSchemaVersion, openSQLite, withTransaction } from "./sqlite";

const SCHEMA_VERSION = 11;

/** A transcript's indexed position and its session metadata. */
type AnalyticsFile = {
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
  features: FeatureRow[];
};

/** Local SQLite store for indexed transcript usage. */
export class AnalyticsStore {
  readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = openSQLite(path);
    ensureSchemaVersion(this.database, SCHEMA_VERSION, () => {
      this.database.exec(`DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS files;
        DROP TABLE IF EXISTS tool_calls; DROP TABLE IF EXISTS shell_commands; DROP TABLE IF EXISTS features;
        DROP TABLE IF EXISTS skipped_files;
        CREATE TABLE files (
          file_path TEXT PRIMARY KEY, size INTEGER NOT NULL, offset INTEGER NOT NULL, session_id TEXT NOT NULL,
          parent_session TEXT
        );
        CREATE TABLE usage (
          file_path TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, entry_id TEXT NOT NULL,
          position INTEGER NOT NULL, is_reply INTEGER NOT NULL, timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
          thinking TEXT NOT NULL, input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL,
          cache_write INTEGER NOT NULL, cost REAL NOT NULL, stop_reason TEXT NOT NULL,
          PRIMARY KEY(file_path, entry_id)
        );
        CREATE TABLE tool_calls (
          file_path TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT NOT NULL, call_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, thinking TEXT NOT NULL,
          tool TEXT NOT NULL, code_search INTEGER NOT NULL, from_line_one INTEGER NOT NULL, agent_name TEXT,
          failed INTEGER, exited INTEGER, failure_line TEXT,
          PRIMARY KEY(file_path, call_id)
        );
        CREATE TABLE shell_commands (
          file_path TEXT NOT NULL, call_id TEXT NOT NULL, name TEXT NOT NULL, timestamp INTEGER NOT NULL,
          PRIMARY KEY(file_path, call_id, name)
        );
        CREATE TABLE features (
          file_path TEXT NOT NULL, entry_id TEXT NOT NULL, kind TEXT NOT NULL, timestamp INTEGER NOT NULL,
          position INTEGER NOT NULL,
          PRIMARY KEY(file_path, entry_id)
        );
        CREATE TABLE skipped_files (file_path TEXT PRIMARY KEY);`);
    });
    // Outside the rebuild: the other tables come back from the session files, but a dialog is recorded only once.
    this.database.exec(`CREATE TABLE IF NOT EXISTS approvals (
      dialog_id TEXT NOT NULL, rule TEXT NOT NULL, timestamp INTEGER NOT NULL, provider TEXT NOT NULL,
      model TEXT NOT NULL, thinking TEXT NOT NULL, choice TEXT NOT NULL, cwd TEXT,
      PRIMARY KEY(dialog_id, rule)
    );`);
    // Older databases get the folder in place, so the dialogs they already hold survive with a NULL project.
    const approvalsColumns = this.database.prepare("PRAGMA table_info(approvals)").all() as { name: string }[];
    if (!approvalsColumns.some(({ name }) => name === "cwd")) {
      this.database.exec("ALTER TABLE approvals ADD COLUMN cwd TEXT");
    }
  }

  /** Replaces a transcript's rows and progress after a reset or reindex. */
  replaceFile(file: AnalyticsFile, rows: FileRows): void {
    withTransaction(this.database, () => {
      this.database.prepare("DELETE FROM usage WHERE file_path = ?").run(file.path);
      this.database.prepare("DELETE FROM tool_calls WHERE file_path = ?").run(file.path);
      this.database.prepare("DELETE FROM shell_commands WHERE file_path = ?").run(file.path);
      this.database.prepare("DELETE FROM features WHERE file_path = ?").run(file.path);
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

  /** Whether a transcript was excluded as another extension's session. */
  isSkipped(path: string): boolean {
    return this.database.prepare("SELECT 1 FROM skipped_files WHERE file_path = ?").get(path) !== undefined;
  }

  /** Remembers an excluded transcript by path only, so later growth never makes it eligible. */
  skipFile(path: string): void {
    this.database.prepare("INSERT OR IGNORE INTO skipped_files(file_path) VALUES (?)").run(path);
  }

  /** Number of existing transcripts excluded as another extension's sessions. */
  skippedCount(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM skipped_files").get() as { count: number };
    return row.count;
  }

  /** Paths of indexed and skipped transcripts, so the indexer can remove source files that disappeared. */
  filePaths(): string[] {
    return (
      this.database.prepare("SELECT file_path FROM files UNION SELECT file_path FROM skipped_files").all() as {
        file_path: string;
      }[]
    ).map(({ file_path }) => file_path);
  }

  /** Removes transcripts whose source files are confirmed to be gone. */
  removeFiles(paths: readonly string[]): void {
    if (paths.length === 0) return;

    withTransaction(this.database, () => {
      for (const path of paths) {
        this.database.prepare("DELETE FROM usage WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM tool_calls WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM shell_commands WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM features WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM files WHERE file_path = ?").run(path);
        this.database.prepare("DELETE FROM skipped_files WHERE file_path = ?").run(path);
      }
    });
  }

  /**
   * Records one permission dialog as it happens, one row per rule that asked, so the report can count dialogs by rule
   * and by choice. The session files don't hold dialogs, so this is the store's one live write.
   */
  recordApproval(approval: Approval): void {
    const dialogId = randomUUID();
    const timestamp = Date.now();
    withTransaction(this.database, () => {
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO approvals(dialog_id, rule, timestamp, provider, model, thinking, choice, cwd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const rule of approval.rules) {
        insert.run(
          dialogId,
          rule,
          timestamp,
          approval.provider,
          approval.model,
          approval.thinking,
          approval.choice,
          approval.cwd,
        );
      }
    });
  }

  close(): void {
    this.database.close();
  }

  private insertRows(file: AnalyticsFile, rows: FileRows): void {
    const insertUsage = this.database.prepare(
      `INSERT OR IGNORE INTO usage(file_path, session_id, cwd, entry_id, position, is_reply, timestamp, provider, model,
        thinking, input, output, cache_read, cache_write, cost, stop_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows.usage) {
      insertUsage.run(
        file.path,
        file.header.id,
        file.header.cwd,
        row.entryId,
        row.position ?? 0,
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
        tool, code_search, from_line_one, agent_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        call.agentName ?? null,
      );
      for (const name of call.commandNames) {
        insertCommand.run(file.path, call.callId, name, call.timestamp);
      }
    }

    const insertFeature = this.database.prepare(
      "INSERT OR IGNORE INTO features(file_path, entry_id, kind, timestamp, position) VALUES (?, ?, ?, ?, ?)",
    );
    for (const feature of rows.features) {
      insertFeature.run(file.path, feature.entryId, feature.kind, feature.timestamp, feature.position ?? 0);
    }

    const settleCall = this.database.prepare(
      "UPDATE tool_calls SET failed = ?, exited = ?, failure_line = ? WHERE file_path = ? AND call_id = ?",
    );
    for (const result of rows.results) {
      settleCall.run(
        result.failed ? 1 : 0,
        result.exited ? 1 : 0,
        result.failureLine ?? null,
        file.path,
        result.callId,
      );
    }
  }

  private saveProgress(file: AnalyticsFile): void {
    this.database
      .prepare(
        "INSERT OR REPLACE INTO files(file_path, size, offset, session_id, parent_session) VALUES (?, ?, ?, ?, ?)",
      )
      .run(file.path, file.size, file.offset, file.header.id, file.header.parentSession ?? null);
  }
}
