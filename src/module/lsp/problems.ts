import { extname } from "node:path";
import type { Problem } from "#core/events";
import { isNodeError } from "#core/util/errors";
import type { LspClient } from "./client";
import type { Lookup, ReadyLookup, ServerManager } from "./manager";
import { languageIdOf } from "./servers";
import { fileProblems } from "./tools/diagnostics";

/**
 * The problems the servers find in `files`, for the done check's `diagnostics` question. Files no server serves are
 * skipped, and so are those whose server is turned off; one that isn't installed or failed to start is skipped too,
 * with `unavailable` told why, so the user can fix it. Each server is brought up to date with the disk once, before
 * its first file.
 */
export async function problemsIn(
  servers: ServerManager,
  files: readonly string[],
  unavailable: (lookup: Exclude<Lookup, { kind: "ready" }>, extension: string) => void,
  signal?: AbortSignal,
): Promise<Problem[]> {
  const problems: Problem[] = [];
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
    problems.push(...(await problemsOf(lookup, file, signal)));
  }
  return problems;
}

/** The file's problems, or none when it's gone: deleted since the done check listed it. */
async function problemsOf({ client, spec }: ReadyLookup, file: string, signal?: AbortSignal): Promise<Problem[]> {
  try {
    return await fileProblems(client, spec, file, signal);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}
