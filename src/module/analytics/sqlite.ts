import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 5000;

/** Opens a local SQLite file configured for multiple pi windows. */
export function openSQLite(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  return database;
}

/** Rebuilds a versioned schema inside one transaction when the stored version changes. */
export function ensureSchemaVersion(database: DatabaseSync, version: number, rebuild: () => void): void {
  withTransaction(database, () => {
    database.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);");
    const current = database.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;
    if (current?.version === version) return;

    rebuild();
    database.exec("DELETE FROM schema_version;");
    database.prepare("INSERT INTO schema_version(version) VALUES (?)").run(version);
  });
}

/** Runs the operation atomically, rolling it back if it throws. */
export function withTransaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
