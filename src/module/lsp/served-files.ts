import { extname } from "node:path";
import type { LspClient } from "./client";
import type { Lookup, ReadyLookup, ServerManager } from "./manager";
import { languageIdOf } from "./servers";

/**
 * Calls `visit` for each of `files` a running server serves, in order, for the done check's questions. Files no server
 * serves are skipped, and so are those whose server is turned off; one that isn't installed or failed to start is
 * skipped too, with `unavailable` told why, so the user can fix it. Each server is brought up to date with the disk
 * once, before its first file.
 */
export async function forEachServedFile(
  servers: ServerManager,
  files: readonly string[],
  unavailable: (lookup: Exclude<Lookup, { kind: "ready" }>, extension: string) => void,
  visit: (lookup: ReadyLookup, file: string) => Promise<void>,
): Promise<void> {
  const current = new Set<LspClient>();

  for (const file of files) {
    if (!servers.specs.some((spec) => languageIdOf(spec, file) !== undefined)) continue;

    const lookup = await servers.clientFor(file);
    if (lookup.kind !== "ready") {
      unavailable(lookup, extname(file));
      continue;
    }

    if (!current.has(lookup.client)) {
      await servers.reportDiskChanges(lookup);
      await lookup.client.syncOpen();
      current.add(lookup.client);
    }
    await visit(lookup, file);
  }
}
