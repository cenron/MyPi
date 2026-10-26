import { basename, dirname } from "node:path";
import type { Duplicate } from "#core/channels";
import { errorMessage } from "#core/util/errors";
import { git } from "#core/worktree/git";
import { duplicateLocations, isTestFile, newDeclarations } from "./duplicates";
import type { Lookup, ServerManager } from "./manager";
import { forEachServedFile } from "./served-files";
import { languageIdOf } from "./servers";
import { namedSymbols } from "./symbols";

/** git's message for a path the last commit doesn't have, such as a file created since. */
const NOT_IN_HEAD = /exists on disk, but not in|does not exist in/;

/** New top-level declarations in changed files that the project's language servers find elsewhere. */
export async function duplicatesIn(
  servers: ServerManager,
  files: readonly string[],
  unavailable: (lookup: Exclude<Lookup, { kind: "ready" }>, extension: string) => void,
  signal?: AbortSignal,
): Promise<Duplicate[]> {
  const duplicates: Duplicate[] = [];
  const sources = files.filter((file) => !isTestFile(file));

  await forEachServedFile(servers, sources, unavailable, async ({ client, spec }, file) => {
    const { uri } = await client.sync(file, languageIdOf(spec, file) ?? "");
    const symbols = namedSymbols(await client.documentSymbols(uri, signal));
    for (const symbol of newDeclarations(symbols, await committedText(file))) {
      const name = symbol.path.at(-1) ?? "";
      for (const match of duplicateLocations(name, file, await client.workspaceSymbols(name, signal))) {
        if (!isTestFile(match.file)) duplicates.push({ name, file, line: symbol.start + 1, elsewhere: match });
      }
    }
  });
  return duplicates;
}

/** The file as last committed; empty for a file that's new since then. Any other git failure is thrown. */
async function committedText(file: string): Promise<string> {
  try {
    // `HEAD:./name` from the file's own folder: no path to relate to the repository root, which git gives as a real
    // path (`/private/var/…` for `/var/…` on macOS).
    return await git(dirname(file), ["show", `HEAD:./${basename(file)}`]);
  } catch (error) {
    if (NOT_IN_HEAD.test(errorMessage(error))) return "";
    throw error;
  }
}
