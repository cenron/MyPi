import type { Dirent } from "node:fs";
import { type FileHandle, open, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { isNodeError } from "#core/util/errors";
import { type ParsedEntry, parseEntry } from "./entries";
import type { AnalyticsStore, FileRows } from "./store";

const READ_CHUNK_SIZE = 64 * 1024;
const HEADER_CHUNK_SIZE = 1024;

/** Indexes every session JSONL under the supplied main and subagent roots. */
export async function indexSessions(roots: readonly string[], store: AnalyticsStore, homeDir: string): Promise<void> {
  const currentFiles = new Set<string>();
  for (const root of roots) {
    for (const file of await sessionFiles(root)) {
      currentFiles.add(file);
      await indexFile(file, store, homeDir);
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

async function indexFile(file: string, store: AnalyticsStore, homeDir: string): Promise<void> {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const { line, end } = await firstLine(handle);
    const header = parseEntry(line, homeDir)?.header;
    if (!header) return;

    const progress = store.fileProgress(file);
    const reset = progress === undefined || size < progress.size || progress.sessionId !== header.id;
    const offset = reset ? end : progress.offset;
    const bytes = await readFrom(handle, offset, size);
    const lastNewline = bytes.lastIndexOf(10);
    const completeBytes = lastNewline < 0 ? 0 : lastNewline + 1;
    const rows: FileRows = { usage: [], calls: [], results: [] };
    for (const text of bytes.subarray(0, completeBytes).toString("utf8").split("\n")) {
      if (!text) continue;
      collectRows(parseEntry(text, homeDir), rows);
    }
    const indexedFile = { path: file, header, size, offset: offset + completeBytes };
    if (reset) store.replaceFile(indexedFile, rows);
    else store.appendFile(indexedFile, rows);
  } finally {
    await handle.close();
  }
}

function collectRows(entry: ParsedEntry | undefined, rows: FileRows): void {
  if (entry?.usage) rows.usage.push(entry.usage);
  if (entry?.calls) rows.calls.push(...entry.calls);
  if (entry?.results) rows.results.push(...entry.results);
}

async function firstLine(handle: FileHandle): Promise<{ line: string; end: number }> {
  const buffer = Buffer.alloc(HEADER_CHUNK_SIZE);
  let bytes = Buffer.alloc(0);
  let position = 0;
  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) return { line: bytes.toString("utf8"), end: position };
    const chunk = buffer.subarray(0, bytesRead);
    const newline = chunk.indexOf(10);
    if (newline >= 0) {
      return { line: Buffer.concat([bytes, chunk.subarray(0, newline)]).toString("utf8"), end: position + newline + 1 };
    }
    bytes = Buffer.concat([bytes, chunk]);
    position += bytesRead;
  }
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
