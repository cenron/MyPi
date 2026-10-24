import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

/**
 * Every folder at or above `dir` that holds one of `markers`, nearest first. A server starts in the first (a monorepo
 * package gets the server of its own `tsconfig.json`) or, for a server that wants the whole workspace, the last.
 */
export function markedFolders(dir: string, markers: readonly string[]): string[] {
  const folders: string[] = [];
  for (;;) {
    if (markers.some((marker) => existsSync(join(dir, marker)))) folders.push(dir);

    const parent = dirname(dir);
    if (parent === dir) return folders;
    dir = parent;
  }
}

/**
 * The executable `command` resolves to: itself when it's an absolute path, otherwise the first match in `path`
 * (`PATH`'s format). Undefined when there's none, so the caller can show how to install it.
 */
export function findCommand(command: string, path = process.env.PATH ?? ""): string | undefined {
  const candidates = isAbsolute(command)
    ? [command]
    : path
        .split(delimiter)
        .filter(Boolean)
        .map((dir) => join(dir, command));
  return candidates.find(isExecutableFile);
}

function isExecutableFile(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
