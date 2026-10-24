import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type Segment, tokenize } from "./shell";

const UNICODE_SPACES = /[  -   　]/g;
/** `name=value` words, such as `--file=x`, `if=x` (dd), or `VAR=x`: the value is what may be a path. */
const ASSIGNMENT = /^[-\w.]+=(.*)$/s;

/** `$HOME` and `${HOME}` where they start a path, for commands `tokenize` gives up on. */
const HOME_VARIABLE = /\$(?:HOME|\{HOME\})(?=\/|$|[\s;|&)'"`])/g;

/** What splits a command into words when `tokenize` gives up: spaces, operators, quotes, and `=`. */
const RAW_WORD_BREAK = /[\s;|&()<>'"`=]+/;

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

/**
 * The places a bash command names, resolved to absolute paths: every word that reads as a path (see `isPathWord`),
 * every `<` target, and every `cd` target, with later words resolved from the folder a `cd` moved to. When `tokenize`
 * gives up (`$(…)`, variables, redirects to files), the raw text is split instead and `$HOME` counts as `~`.
 */
export function commandPaths(command: string, cwd: string, home: string): string[] {
  const segments = tokenize(command);
  if (segments === undefined) return rawPaths(command, cwd, home);

  return segmentPaths(segments, cwd, home);
}

function segmentPaths(segments: Segment[], cwd: string, home: string): string[] {
  const paths: string[] = [];
  let dir = cwd;

  for (const { words, inputs } of segments) {
    for (const input of inputs) paths.push(resolveToolPath(input, dir, home));

    const [name, ...args] = words;
    if (name === "cd") {
      const target = cdTarget(args);
      // `cd -` goes to the shell's previous folder, which no word names.
      if (target !== "-") {
        dir = resolveToolPath(target ?? "~", dir, home);
        paths.push(dir);
      }
      continue;
    }

    for (const word of words.map(assignedValue).filter(isPathWord)) paths.push(resolveToolPath(word, dir, home));
  }

  return paths;
}

function rawPaths(command: string, cwd: string, home: string): string[] {
  const words = command.replace(HOME_VARIABLE, "~").split(RAW_WORD_BREAK);
  return words.filter(isPathWord).map((word) => resolveToolPath(word, cwd, home));
}

/** `cd`'s folder: its first argument that isn't an option (`-L`, `-P`, `--`), or undefined for a bare `cd`. */
function cdTarget(args: string[]): string | undefined {
  return args.find((arg) => arg === "-" || !arg.startsWith("-"));
}

/** A word without its `name=` part, if it has one. */
function assignedValue(word: string): string {
  return ASSIGNMENT.exec(word)?.[1] ?? word;
}

/**
 * True for a word that names a place, so the guard should check it: it starts with `/`, `~/`, or `file://`, is `~`,
 * or has a `..` step. Other URLs (`https://…`) aren't paths, and a plain relative word (`src/a.ts`) stays inside.
 */
function isPathWord(word: string): boolean {
  if (word.startsWith("file://")) return true;
  if (word.includes("://")) return false;

  return word.startsWith("/") || word === "~" || word.startsWith("~/") || word.split("/").includes("..");
}
