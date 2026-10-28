import type { Dirent } from "node:fs";
import { type FileHandle, open, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { MYPI_SESSION_MARKER_TYPE } from "#core/session-marker";
import { isNodeError } from "#core/util/errors";
import { isRecord } from "#core/util/guards";
import { type ParsedEntry, parseEntry } from "./entries";
import type { AnalyticsStore, FileRows } from "./store";

const READ_CHUNK_SIZE = 64 * 1024;
const HEADER_CHUNK_SIZE = 1024;
const SESSION_MARKER_LINES = 16;
/**
 * Sessions started before MyPi marked its sessions (2026-10-27) have no marker, so they're read in full once and kept
 * when they show MyPi anywhere. Every later session needs the marker in its first lines, or its rest is never read.
 */
const MARKER_SINCE = Date.parse("2026-10-28T00:00:00.000Z");
const MYPI_CUSTOM_PREFIX = "mypi-";
/** Tools only MyPi has: how a session from before the marker shows it ran MyPi. */
const MYPI_TOOLS = new Set([
  "agent_manage",
  "ask_user",
  "job_list",
  "job_stop",
  "job_wait",
  "lsp",
  "lsp_edit",
  "subagent",
  "subagent_apply",
  "submit_plan",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
  "web_fetch",
  "web_search",
]);

/** A folder of session files; in one only MyPi writes (subagent runs), every session is MyPi's. */
type SessionRoot = { path: string; mypiOnly: boolean };

/** Indexes MyPi's session files under the roots; other sessions are skipped after their first lines. */
export async function indexSessions(
  roots: readonly SessionRoot[],
  store: AnalyticsStore,
  homeDir: string,
): Promise<void> {
  const currentFiles = new Set<string>();
  for (const root of roots) {
    for (const file of await sessionFiles(root.path)) {
      currentFiles.add(file);
      if (store.isSkipped(file)) continue;
      await indexFile(file, store, homeDir, root.mypiOnly);
    }
  }

  const missingFiles: string[] = [];
  for (const file of store.filePaths()) {
    if (currentFiles.has(file)) continue;
    try {
      await stat(file);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") missingFiles.push(file);
      else throw error;
    }
  }
  store.removeFiles(missingFiles);
}

async function indexFile(file: string, store: AnalyticsStore, homeDir: string, mypiOnly: boolean): Promise<void> {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const { lines, headerEnd } = await firstLines(handle);
    const header = parseEntry(lines[0] ?? "", homeDir)?.header;
    if (!header) return;

    const progress = store.fileProgress(file);
    // Already indexed, in MyPi's own folder, or marked: MyPi's. Otherwise only a session from before the marker is read.
    const known = mypiOnly || progress !== undefined || isMyPiSession(lines, homeDir);
    const legacy = !known && (header.timestamp ?? 0) < MARKER_SINCE;
    if (!known && !legacy) {
      store.skipFile(file);
      return;
    }

    const reset = progress === undefined || size < progress.size || progress.sessionId !== header.id;
    const offset = reset ? headerEnd : progress.offset;
    const bytes = await readFrom(handle, offset, size);
    const lastNewline = bytes.lastIndexOf(10);
    const completeBytes = lastNewline < 0 ? 0 : lastNewline + 1;
    const rows: FileRows = { usage: [], calls: [], results: [], features: [] };
    let linePosition = offset;
    for (const text of bytes.subarray(0, completeBytes).toString("utf8").split("\n")) {
      if (text) collectRows(parseEntry(text, homeDir), rows, linePosition);
      linePosition += Buffer.byteLength(text) + 1;
    }
    if (legacy && !showsMyPi(rows)) {
      store.skipFile(file);
      return;
    }

    // Only subagent runs (the subagents root) are children: a `/plan implement` session links to its parent too, and
    // would be counted as a run of the last agent that parent called.
    const indexedHeader = mypiOnly ? header : { ...header, parentSession: undefined };
    const indexedFile = { path: file, header: indexedHeader, size, offset: offset + completeBytes };
    if (reset) store.replaceFile(indexedFile, rows);
    else store.appendFile(indexedFile, rows);
  } finally {
    await handle.close();
  }
}

function collectRows(entry: ParsedEntry | undefined, rows: FileRows, position: number): void {
  if (entry?.usage) rows.usage.push({ ...entry.usage, position });
  if (entry?.calls) rows.calls.push(...entry.calls);
  if (entry?.results) rows.results.push(...entry.results);
  if (entry?.features) rows.features.push(...entry.features.map((feature) => ({ ...feature, position })));
}

async function firstLines(handle: FileHandle): Promise<{ lines: string[]; headerEnd: number }> {
  const buffer = Buffer.alloc(HEADER_CHUNK_SIZE);
  let bytes = Buffer.alloc(0);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return sessionPrefix(bytes);

    const chunk = buffer.subarray(0, bytesRead);
    bytes = Buffer.concat([bytes, chunk]);
    position += bytesRead;
    if (countLines(bytes) >= SESSION_MARKER_LINES) return sessionPrefix(bytes);
  }
}

function sessionPrefix(bytes: Buffer): { lines: string[]; headerEnd: number } {
  const firstNewline = bytes.indexOf(10);
  const end = bytes.lastIndexOf(10) + 1;
  const completeLines = bytes.subarray(0, end).toString("utf8").split("\n").slice(0, SESSION_MARKER_LINES);
  return { lines: completeLines, headerEnd: firstNewline < 0 ? bytes.length : firstNewline + 1 };
}

function countLines(bytes: Buffer): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 10) count++;
  }
  return count;
}

function isMyPiSession(lines: readonly string[], homeDir: string): boolean {
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value)) continue;
    if (value.type === "custom" && value.customType === MYPI_SESSION_MARKER_TYPE) return true;
    if (
      (value.type === "custom" || value.type === "custom_message") &&
      typeof value.customType === "string" &&
      value.customType.startsWith(MYPI_CUSTOM_PREFIX)
    ) {
      return true;
    }
    if (parseEntry(line, homeDir)?.calls?.some(({ tool }) => MYPI_TOOLS.has(tool))) return true;
  }
  return false;
}

/** Whether a whole session's rows show it ran MyPi: one of MyPi's tools, or one of its notices. */
function showsMyPi(rows: FileRows): boolean {
  return rows.features.length > 0 || rows.calls.some(({ tool }) => MYPI_TOOLS.has(tool));
}

async function readFrom(handle: FileHandle, offset: number, size: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for (let position = offset; position < size; ) {
    const buffer = Buffer.alloc(Math.min(READ_CHUNK_SIZE, size - position));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    chunks.push(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return Buffer.concat(chunks);
}

async function sessionFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [root];
  while (folders.length) {
    const folder = folders.pop();
    if (folder === undefined) continue;
    let entries: Dirent[];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) folders.push(path);
      else if (entry.isFile() && extname(entry.name) === ".jsonl") files.push(path);
    }
  }
  return files;
}
