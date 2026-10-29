import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isEditToolResult, isWriteToolResult, type ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { type Segment, tokenize } from "./shell";

const UNICODE_SPACES = /[  -   　]/g;
/** `name=value` words, such as `--file=x`, `if=x` (dd), or `VAR=x`: the value is what may be a path. */
const ASSIGNMENT = /^[-\w.]+=(.*)$/s;

/** Commands whose words are text for another program, not paths: a pi there runs its own folder guard. */
const FORWARDED_TEXT_COMMANDS = [
  ["herdr", "pane", "send-text"],
  ["herdr", "agent", "prompt"],
];

/** `$HOME` and `${HOME}` where they start a path, for commands `tokenize` gives up on. */
const HOME_VARIABLE = /\$(?:HOME|\{HOME\})(?=\/|$|[\s;|&)'"`])/g;

/** What splits a command into words when `tokenize` gives up: spaces, operators, quotes, and `=`. */
const RAW_WORD_BREAK = /[\s;|&()<>'"`=]+/;

/** What splits a quoted string with no spaces: the same, minus `|`, `<`, and `>`, which a pattern or tag keeps. */
const QUOTED_WORD_BREAK = /[;&()`=]+/;

/** A command's text in order: single-quoted strings, double-quoted strings, then the runs between (or a lone quote). */
const RAW_PART = /'[^']*'|"(?:\\.|[^"\\])*"|[^'"]+|['"]/g;

/** `sed`'s options whose next word is a script: `-e`, a cluster ending in it (`-ne`), and `--expression`. */
const SED_SCRIPT_OPTION = /^(-[a-zA-Z]*e|--expression)$/;

/** Slashes and stars alone (`/`, `//`, `/**`): in text the shell parser gave up on, code rather than a place. */
const SYMBOLS_ONLY = /^[/*]+$/;

/** An HTML or XML tag (`<cwd>`, `</cwd>`), which in a heredoc's body is markup, not a redirect. */
const MARKUP_TAG = /<\/?[A-Za-z][\w:-]*>/g;

/** A heredoc's opener line when a plain writer takes its body, at the start or after `cd <word> &&`. */
const WRITTEN_HEREDOC = /^\s*(?:cd\s+\S+\s*&&\s*)?(?:cat|tee|printf|echo)\b/;

/** A process substitution or a backtick in the opener's command: bash runs it, and it can take the body. */
const RUNS_INLINE = /[()`]/;

/** A separator after the writer: another command on the line, which takes the body instead. */
const CHAINED_COMMAND = /[;&|]/;

/** A heredoc opener: `<<`, an optional `-`, then its delimiter, quoted (`'EOF'`, `"EOF"`) or escaped (`\EOF`). */
const HEREDOC_OPEN = /<<(-?)\s*(\\?)(['"]?)([A-Za-z_]\w*)\3/;

/** What may follow a heredoc's delimiter on its opener line: redirects to a word, which put the body in a file. */
const WRITTEN_AFTER_MARKER = /^\s*(?:[0-9&]?>>?\s*[^\s()|;&]+\s*)*$/;

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

/** The file a successful `write` or `edit` changed, resolved as pi resolved it; undefined for any other result. */
export function changedFile(ev: ToolResultEvent, cwd: string, home: string): string | undefined {
  if (ev.isError || !(isWriteToolResult(ev) || isEditToolResult(ev))) return undefined;

  const path = ev.input.path;
  return typeof path === "string" ? resolveToolPath(path, cwd, home) : undefined;
}

/**
 * True when `path` is `dir` itself or below it. Both should be absolute. Compares text, not the file system, so a
 * symlink under `dir` that points elsewhere counts as inside. `startsWith` would let `dir-evil/` through.
 */
export function isInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Whether an absolute path starts at a folder that exists at `/`; missing roots cannot reach anyone's files. */
export function hasExistingRoot(path: string, rootEntries: readonly string[]): boolean {
  const root = path.split(sep).filter(Boolean)[0];
  return root === undefined || rootEntries.includes(root);
}

/** `file` relative to `cwd` when it's inside, so lines stay short; as given otherwise. */
export function displayPath(file: string, cwd: string): string {
  return isInside(cwd, file) ? relative(cwd, file) || file : file;
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
 * gives up (`$(…)`, variables, redirects to files), the raw text is split instead and `$HOME` counts as `~`. The words
 * of a command that forwards text to another pane (`herdr pane send-text`) aren't paths; its `<` targets are.
 */
export function commandPaths(command: string, cwd: string, home: string): string[] {
  const segments = tokenize(command);
  if (segments === undefined) return rawPaths(command, cwd, home);

  return segmentPaths(segments, cwd, home);
}

/** True for a command that sends its words to another program as text (`FORWARDED_TEXT_COMMANDS`). */
function isForwardedTextCommand(words: readonly string[]): boolean {
  return FORWARDED_TEXT_COMMANDS.some((prefix) => prefix.every((word, index) => words[index] === word));
}

function segmentPaths(segments: Segment[], cwd: string, home: string): string[] {
  const paths: string[] = [];
  let dir = cwd;

  for (const { words, inputs } of segments) {
    for (const input of inputs) paths.push(resolveToolPath(input, dir, home));

    if (isForwardedTextCommand(words)) continue;

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

    for (const word of withoutSedScripts(words).map(assignedValue).filter(isPathWord)) {
      paths.push(resolveToolPath(word, dir, home));
    }
  }

  return paths;
}

/**
 * The path words in text `tokenize` gave up on, resolved from the folder a `cd` moved to as `segmentPaths` does for
 * text it can read. A quoted string with no spaces stays whole apart from `=` and separators, so a pattern
 * (`'/a/|/b/'`) or a tag (`'</cwd>'`) isn't split into paths; anything with spaces, quoted or not, is split
 * everywhere, so a stray apostrophe in a heredoc can't hide a path behind a long "quoted" span.
 */
function rawPaths(command: string, cwd: string, home: string): string[] {
  const paths: string[] = [];
  let dir = cwd;

  for (const text of rawSegments(blankWrittenHeredocs(command.replace(HOME_VARIABLE, "~")))) {
    const words = rawWords(text).filter(Boolean);
    const [name = "", ...args] = words;
    // A backtick names a folder only when the command runs, like a `$dir` target, so neither moves `dir`.
    if (name === "cd" && !text.includes("`")) {
      const target = cdTarget(args);
      // `cd -` returns to the shell's previous folder, which no word names.
      if (target === undefined || (target !== "-" && !/[$`]/.test(target))) {
        dir = resolveToolPath(target ?? "~", dir, home);
        paths.push(dir);
      }
      continue;
    }

    // A heredoc's code divides and comments (`a / b`, `/**`); those words aren't places.
    for (const word of words) {
      if (isPathWord(word) && !SYMBOLS_ONLY.test(word)) paths.push(resolveToolPath(word, dir, home));
    }
  }

  return paths;
}

/**
 * The raw text's words: single-quoted strings, double-quoted strings, then the runs between (or a lone quote), split
 * as the fallback always has.
 */
function rawWords(text: string): string[] {
  const parts = text.match(RAW_PART) ?? [];
  return parts.flatMap((part) => {
    const quoted = isQuoted(part);
    const inner = quoted ? part.slice(1, -1) : part;
    if (quoted && !/\s/.test(inner)) return inner.split(QUOTED_WORD_BREAK);
    return inner.replace(MARKUP_TAG, " ").split(RAW_WORD_BREAK);
  });
}

/** True for a whole quoted string, as `RAW_PART` gives one; a lone quote, with no partner, isn't. */
function isQuoted(part: string): boolean {
  return part.length > 1 && (part.startsWith("'") || part.startsWith('"'));
}

/**
 * The raw text's commands in order, split where a new one starts: a line start, or an unquoted `&&`, `||`, `;`, `|`,
 * or `&`. A quoted string stays in one piece, as it does in `rawWords`, so a separator inside quotes isn't one.
 */
function rawSegments(text: string): string[] {
  const segments = [""];
  for (const part of text.match(RAW_PART) ?? []) {
    const pieces = isQuoted(part) ? [part] : part.split(/(?<=[;|&\n])/);
    segments[segments.length - 1] += pieces[0] ?? "";
    segments.push(...pieces.slice(1));
  }
  return segments;
}

/**
 * `text` with the body of every heredoc that is only written, not run, blanked (its lines kept, so later text stays
 * where it was). A plain writer's body is data, code for a file or text on stdout, so the paths its code names aren't
 * places the command reaches. A body that runs (`bash`, `node`, `python3`), one bash expands (an unquoted delimiter
 * with `$` or a backtick in it), one piped on, and one whose call carries on after it all stay: those paths can be
 * reached.
 */
function blankWrittenHeredocs(text: string): string {
  const lines = text.split("\n");
  const blanked = [...lines];

  for (let open = 0; open < lines.length; open++) {
    const line = lines[open] ?? "";
    const marker = HEREDOC_OPEN.exec(line);
    if (!marker) continue;

    const [, dash = "", escaped = "", quote = "", delimiter = ""] = marker;
    const before = line.slice(0, marker.index);
    const after = line.slice(marker.index + marker[0].length);
    // `<<<` is a herestring, and a quote before `<<` makes the marker text.
    if (line[marker.index - 1] === "<" || /['"]/.test(before)) continue;
    const writer = WRITTEN_HEREDOC.exec(before);
    if (!writer || !WRITTEN_AFTER_MARKER.test(after)) continue;
    // One writer's command, nothing chained after it, and no process substitution on either side: `cat a && bash`,
    // `echo hi; python3` and `tee >(bash)` all hand the body to a program that runs what it names.
    if (RUNS_INLINE.test(before) || CHAINED_COMMAND.test(before.slice(writer[0].length))) continue;

    let close = -1;
    for (let index = open + 1; index < lines.length; index++) {
      const candidate = lines[index] ?? "";
      if ((dash === "-" ? candidate.replace(/^\t+/, "") : candidate) === delimiter) {
        close = index;
        break;
      }
    }
    if (close < 0) continue;

    // A command after the closing line runs the file: `cat > run.sh <<'EOF'` … `EOF` then `bash run.sh`.
    if (lines.slice(close + 1).some((rest) => rest.trim() !== "")) continue;
    // An unquoted, unescaped delimiter lets bash expand the body, so it isn't only text yet.
    if (escaped === "" && quote === "" && lines.slice(open + 1, close).some((body) => /[$`]/.test(body))) continue;

    for (let index = open + 1; index < close; index++) blanked[index] = "";
    open = close;
  }

  return blanked.join("\n");
}

/**
 * A `sed` command's words without its scripts, which are text, not paths: each `-e` value (also in a cluster such as
 * `-ne`), or the first operand when no `-e` or `-f` gives one. `-f`'s file stays, since it is one.
 */
function withoutSedScripts(words: readonly string[]): string[] {
  const [name, ...args] = words;
  if (name !== "sed") return [...words];

  let scriptGiven = args.some((arg) => SED_SCRIPT_OPTION.test(arg) || arg === "-f" || arg.startsWith("--file"));
  const kept = [name];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    if (SED_SCRIPT_OPTION.test(arg)) {
      index++; // its value is the script
      continue;
    }
    if (arg.startsWith("--expression=")) continue;
    if (!scriptGiven && !arg.startsWith("-")) {
      scriptGiven = true;
      continue;
    }
    kept.push(arg);
  }
  return kept;
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
 * or has a `..` step. Other URLs (`https://…`) aren't paths, and a plain relative word (`src/a.ts`) stays inside. A
 * word with no spaces holding `|`, `<`, or `>` only gets here from quotes, so it's a pattern or markup
 * (`grep -E '/a/|/b/'`, `'</cwd>'`), not a path.
 */
function isPathWord(word: string): boolean {
  if (/[|<>]/.test(word) && !/\s/.test(word)) return false;
  if (word.startsWith("file://")) return true;
  if (word.includes("://")) return false;

  return word.startsWith("/") || word === "~" || word.startsWith("~/") || word.split("/").includes("..");
}
