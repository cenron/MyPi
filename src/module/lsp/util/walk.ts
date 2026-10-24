import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { FileChangeType } from "vscode-languageserver-protocol/node";

/** How many folders `findSourceFile` looks through before giving up, so a huge tree can't stall a call. */
const MAX_SEARCHED_FOLDERS = 200;
/** How many folders a project's file times cover; changes in folders past it go unseen. */
const MAX_TRACKED_FOLDERS = 2_000;

/** A file that changed on disk, as the protocol reports it. */
export type FileChange = { file: string; type: FileChangeType };

/**
 * The first file under `root` with one of `extensions`, nearest folders first. Undefined when none turns up in
 * `MAX_SEARCHED_FOLDERS` folders. A project search opens it for a server that searches only once a file is open
 * (`beforeSearch: "open_file"`).
 */
export async function findSourceFile(root: string, extensions: readonly string[]): Promise<string | undefined> {
  for await (const { dir, entries } of walkFolders(root, MAX_SEARCHED_FOLDERS)) {
    const file = entries.find((entry) => entry.isFile() && extensions.includes(extname(entry.name)));
    if (file) return join(dir, file.name);
  }
  return undefined;
}

/**
 * Every file under `root` with one of `extensions`, with its modification time, from up to `MAX_TRACKED_FOLDERS`
 * folders. Compared with an earlier one by `fileChanges`, it shows what changed on disk however it changed.
 */
export async function sourceFileTimes(root: string, extensions: readonly string[]): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  for await (const { dir, entries } of walkFolders(root, MAX_TRACKED_FOLDERS)) {
    const files = entries.filter((entry) => entry.isFile() && extensions.includes(extname(entry.name)));
    const stats = await Promise.all(files.map((entry) => modifiedAt(join(dir, entry.name))));
    files.forEach((entry, i) => {
      const time = stats[i];
      if (time !== undefined) times.set(join(dir, entry.name), time);
    });
  }
  return times;
}

/** What changed between two `sourceFileTimes` results: files that appeared, changed, or went away. */
export function fileChanges(before: ReadonlyMap<string, number>, after: ReadonlyMap<string, number>): FileChange[] {
  const changes: FileChange[] = [];
  for (const [file, time] of after) {
    const old = before.get(file);
    if (old === undefined) changes.push({ file, type: FileChangeType.Created });
    else if (old !== time) changes.push({ file, type: FileChangeType.Changed });
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changes.push({ file, type: FileChangeType.Deleted });
  }
  return changes;
}

/** When `file` was last modified, or undefined when it can't be read. */
export async function modifiedAt(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The folders under `root` with their entries, nearest first, skipping hidden folders, `node_modules`, and folders
 * that can't be read. Stops after `maxFolders`.
 */
async function* walkFolders(root: string, maxFolders: number): AsyncGenerator<{ dir: string; entries: Dirent[] }> {
  const queue = [root];
  for (let walked = 0; walked < maxFolders; walked++) {
    const dir = queue.shift();
    if (dir === undefined) return;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable: look elsewhere
    }
    yield { dir, entries };

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        queue.push(join(dir, entry.name));
      }
    }
  }
}
