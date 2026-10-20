import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[  -   　]/g;

/**
 * Resolves a tool's `path` argument to the file pi's edit and write will touch. Mirrors pi's unexported
 * `resolveToCwd` (`normalizePath`/`resolvePath` in pi's `dist/utils/paths.js`), in the same order, minus its win32
 * branch. `home` is a parameter so rules stay pure.
 */
export function resolveToolPath(path: string, cwd: string, home: string): string {
  let p = path.replace(UNICODE_SPACES, " ");
  if (p.startsWith("@")) p = p.slice(1);
  if (p === "~") p = home;
  else if (p.startsWith("~/")) p = join(home, p.slice(2));
  else if (p.startsWith("file://")) p = fileURLToPath(p);

  return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

/**
 * True when `path` is `dir` itself or below it. Both should be absolute. Compares text, not the file system, so a
 * symlink under `dir` that points elsewhere counts as inside. `startsWith` would let `dir-evil/` through.
 */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
