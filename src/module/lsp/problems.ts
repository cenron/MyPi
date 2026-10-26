import type { Problem } from "#core/channels";
import { isNodeError } from "#core/util/errors";
import type { Lookup, ReadyLookup, ServerManager } from "./manager";
import { forEachServedFile } from "./served-files";
import { fileProblems } from "./tools/diagnostics";

/** The problems the servers find in `files`, for the done check's `diagnostics` question (see `forEachServedFile`). */
export async function problemsIn(
  servers: ServerManager,
  files: readonly string[],
  unavailable: (lookup: Exclude<Lookup, { kind: "ready" }>, extension: string) => void,
  signal?: AbortSignal,
): Promise<Problem[]> {
  const problems: Problem[] = [];
  await forEachServedFile(servers, files, unavailable, async (lookup, file) => {
    problems.push(...(await problemsOf(lookup, file, signal)));
  });
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
