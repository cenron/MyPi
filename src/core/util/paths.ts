import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[  -   　]/g;

/**
 * Resolves a tool's `path` argument to the file pi's edit and write will touch. Mirrors pi's unexported
 * `resolveToCwd` (`normalizePath`/`resolvePath` in pi's `dist/utils/paths.js`), in the same order, minus its win32
 * branch. `home` is a parameter so rules stay pure.
 */
export function resolveToolPath(path: string, cwd: string, home: string): string {
  let resolved = path.replace(UNICODE_SPACES, " ");
  if (resolved.startsWith("@")) resolved = resolved.slice(1);
  if (resolved === "~") resolved = home;
  else if (resolved.startsWith("~/")) resolved = join(home, resolved.slice(2));
  else if (resolved.startsWith("file://")) resolved = fileURLToPath(resolved);

  return isAbsolute(resolved) ? resolve(resolved) : resolve(cwd, resolved);
}

/**
 * True when `path` is `dir` itself or below it. Both should be absolute. Compares text, not the file system, so a
 * symlink under `dir` that points elsewhere counts as inside. `startsWith` would let `dir-evil/` through.
 */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/**
 * A new, unused file path in the OS temp directory: `<prefix>-<16 random hex><extension>`. Random, so two pi windows
 * never collide; create the file with `flag: "wx"` so it never follows a link someone else put there.
 *
 * @example
 * const path = tempFilePath("pi-web-fetch", ".md"); // "/var/folders/…/T/pi-web-fetch-3f9a1c0b7e2d4a65.md"
 * await writeFile(path, text, { mode: 0o600, flag: "wx" });
 */
export function tempFilePath(prefix: string, extension: string): string {
  return join(tmpdir(), `${prefix}-${randomBytes(8).toString("hex")}${extension}`);
}
