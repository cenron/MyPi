/** One command of a bash line: its words, and the files its `<` redirects read. */
export type Segment = { words: string[]; inputs: string[] };

/** `tokenize`'s segments, and for each one whether it holds an unquoted glob (`*`, `?`, `[`) that bash expands. */
type Scan = { segments: Segment[]; globbed: boolean[] };

/** What makes `$` expand inside double quotes: a name, a digit, `{`, `(`, or a special parameter like `$@`. */
const EXPANDS_IN_QUOTES = /^[\w{(@*#?!$-]$/;

/** What makes an unquoted `$` expand: the same, plus `$'…'` and `$"…"`, whose text bash rewrites. */
const EXPANDS = /^[\w{(@*#?!$'"-]$/;

/** Most words one brace-expanded word may become before the command just asks. */
const MAX_BRACE_WORDS = 256;

type ArgCheck = (args: string[]) => boolean;

const GIT_READERS = [
  "status",
  "log",
  "show",
  "diff",
  "blame",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "describe",
  "shortlog",
];

const GIT_SUBCOMMANDS = new Map<string, ArgCheck>([
  ...GIT_READERS.map((name): [string, ArgCheck] => [name, () => true]),
  // `-O`/`--open-files-in-pager` runs a program on the matches.
  ["grep", (args) => !hasShort(args, "O") && !hasLong(args, ["--open-files-in-pager"])],
  [
    "branch",
    listOnly("arvl", [
      "--list",
      "--all",
      "--remotes",
      "--verbose",
      "--show-current",
      "--color",
      "--no-color",
      "--column",
      "--no-column",
      "--format",
      "--sort",
      "--contains",
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
    ]),
  ],
  // `-n` takes its line count attached (`-n3`), hence the digits.
  [
    "tag",
    listOnly("ln0123456789", [
      "--list",
      "--sort",
      "--contains",
      "--no-contains",
      "--merged",
      "--no-merged",
      "--points-at",
      "--format",
      "--color",
      "--column",
      "--no-column",
    ]),
  ],
  [
    "remote",
    (args) => args.every((w) => w === "-v" || w === "--verbose") || args[0] === "show" || args[0] === "get-url",
  ],
  // A bare `git stash` pushes.
  ["stash", (args) => args[0] === "list" || args[0] === "show"],
  // Every `worktree list` flag only shapes the output; `--expire <time>` with a separate operand asks.
  ["worktree", ([sub, ...flags]) => sub === "list" && flags.every((w) => w.startsWith("-"))],
  // `--version` sits where the subcommand goes; `--build-options` is the only flag either takes.
  ["--version", (args) => args.every((w) => w.startsWith("-"))],
  ["version", (args) => args.every((w) => w.startsWith("-"))],
  [
    "config",
    (args) =>
      (args[0] === "get" ||
        args[0] === "list" ||
        args.some((w) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(w))) &&
      !args.some((w) =>
        [
          "--add",
          "--unset",
          "--unset-all",
          "--replace-all",
          "--rename-section",
          "--remove-section",
          "--edit",
          "-e",
        ].includes(w),
      ),
  ],
]);

const PLAIN_READERS = [
  "cat",
  "head",
  "tail",
  "wc",
  "ls",
  "pwd",
  "stat",
  "du",
  "df",
  "which",
  "type",
  "whoami",
  "id",
  "date",
  "uname",
  "echo",
  "printf",
  "cut",
  "tr",
  "nl",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "cmp",
  "comm",
  "diff",
  "jq",
  "grep",
];

// A Map, not an object: `READERS["toString"]` on an object literal would find Object.prototype's.
const READERS = new Map<string, ArgCheck>([
  ...PLAIN_READERS.map((name): [string, ArgCheck] => [name, () => true]),
  // `-o` writes the listing to a file.
  ["tree", (args) => !hasShort(args, "o") && !hasLong(args, ["--output"])],
  // `-C` compiles a magic file into the cwd.
  ["file", (args) => !hasShort(args, "C") && !hasLong(args, ["--compile"])],
  ["find", (args) => !args.some((w) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(w))],
  ["fd", (args) => !hasShort(args, "xX") && !hasLong(args, ["--exec", "--exec-batch"])],
  ["rg", (args) => !hasLong(args, ["--pre", "--hostname-bin"])],
  ["sort", (args) => !hasShort(args, "o") && !hasLong(args, ["--output", "--compress-program"])],
  // `uniq in out` writes `out`.
  ["uniq", (args) => operands(args).length <= 1],
  ["sed", sed],
  ["git", git],
  // Changes only this command's folder; the folder guard checks where it goes and reads later paths from there.
  ["cd", () => true],
  ["npm", ([sub = ""]) => ["ls", "list", "view", "info", "outdated"].includes(sub)],
]);

/**
 * Splits a bash command into segments (split on `|`, `||`, `&&`, `;` and newlines) of words with their quotes
 * removed, or returns undefined when the command holds syntax that can run or write something the words don't show:
 * `$(`, backticks, `<(`, `>(`, `(`, a lone `&`, `$'…'` and `$"…"`, variables (`$x`, `${x}`, `$1`, even in double
 * quotes, since one can hold `-delete`), or a redirect other than `N>&M`, `>/dev/null` and `< file`. Redirect targets
 * are left out of the words; a `< file` target is in the segment's `inputs`. Comma braces are expanded as bash does
 * (`a{b,c}` is `ab ac`), so the words show what runs; ranges (`{a..c}`), nested or quoted braces, and braces in a
 * redirect target return undefined.
 */
export function tokenize(command: string): Segment[] | undefined {
  return scan(command)?.segments;
}

/**
 * True only for a command that can't write files or run another program, so Plan can run it without asking. Strict on
 * purpose: a false only costs a confirm. Every segment's first word must be a known reader (or `cd`) whose arguments
 * pass its check; anything else, wrappers like `env` and `xargs` included, is false. A segment with an unquoted glob passes
 * only for a plain reader: the glob can expand to a file named like a flag, as `find *` does with a file `-delete`.
 */
export function isReadOnlyCommand(command: string): boolean {
  const scanned = scan(command);
  if (scanned === undefined || scanned.segments.length === 0) return false;
  return scanned.segments.every(({ words: [name = "", ...args] }, i) => {
    if (scanned.globbed[i] && !PLAIN_READERS.includes(name)) return false;
    return READERS.get(name)?.(args) ?? false;
  });
}

function scan(command: string): Scan | undefined {
  const segments: Segment[] = [];
  const globbed: boolean[] = [];
  let segmentWords: string[] = [];
  let segmentInputs: string[] = [];
  let segmentGlobbed = false;
  let currentWord = "";
  let wordStarted = false; // A quote starts a word too, so '' is preserved.
  let wordParts: (string | string[])[] = []; // text, then each closed brace group's choices
  let group: string[] | undefined; // the open brace group's choices; the last is being read
  let redirectTarget: "input" | "output" | undefined;
  let unsafe = false;

  const finishWord = () => {
    if (!wordStarted) return;
    // An unclosed group stays as typed, like `{a, b}`, which bash leaves alone.
    if (group) currentWord += `{${group.join(",")}`;
    const words = expandBraces([...wordParts, currentWord]);
    if (words === undefined) unsafe = true;
    else if (redirectTarget === undefined) segmentWords.push(...words);
    else if (words.length !== 1 || (redirectTarget === "output" && words[0] !== "/dev/null")) unsafe = true;
    else if (redirectTarget === "input") segmentInputs.push(...words);
    currentWord = "";
    wordStarted = false;
    wordParts = [];
    group = undefined;
    redirectTarget = undefined;
  };

  const finishSegment = () => {
    finishWord();
    if (redirectTarget !== undefined) unsafe = true; // A redirect needs a target.
    if (segmentWords.length > 0 || segmentInputs.length > 0) {
      segments.push({ words: segmentWords, inputs: segmentInputs });
      globbed.push(segmentGlobbed);
    }
    segmentWords = [];
    segmentInputs = [];
    segmentGlobbed = false;
  };

  let i = 0;
  while (i < command.length) {
    const c = command.charAt(i);
    const next = command.charAt(i + 1);

    if (group && (c === "'" || c === '"' || c === "\\")) {
      return undefined; // Quoted text inside braces isn't worth handling.
    } else if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return undefined;
      currentWord += command.slice(i + 1, end);
      wordStarted = true;
      i = end + 1;
    } else if (c === '"') {
      wordStarted = true;
      i++;
      for (;;) {
        if (i >= command.length) return undefined;
        const d = command.charAt(i);
        if (d === '"') break;
        // Substitutions and variables still expand inside double quotes.
        if (d === "`" || (d === "$" && EXPANDS_IN_QUOTES.test(command.charAt(i + 1)))) return undefined;
        if (d === "\\" && '$`"\\\n'.includes(command.charAt(i + 1))) {
          if (command.charAt(i + 1) !== "\n") currentWord += command.charAt(i + 1);
          i += 2;
        } else {
          currentWord += d;
          i++;
        }
      }
      i++;
    } else if (c === "\\") {
      if (next === "") return undefined;
      if (next !== "\n") {
        currentWord += next;
        wordStarted = true;
      }
      i += 2;
    } else if (c === " " || c === "\t") {
      finishWord();
      i++;
    } else if (c === "\n" || c === ";") {
      finishSegment();
      i++;
    } else if (c === "|") {
      finishSegment();
      i += next === "|" ? 2 : 1;
    } else if (c === "&") {
      if (next !== "&") return undefined; // `&` backgrounds, `&>` redirects
      finishSegment();
      i += 2;
    } else if (c === ">") {
      if (redirectTarget !== undefined) return undefined;
      // `2>`: the digits name a file descriptor, not a word.
      if (wordStarted && !group && wordParts.length === 0 && /^\d+$/.test(currentWord)) {
        currentWord = "";
        wordStarted = false;
      } else finishWord();
      const dup = /^>&\d+(?![^\s;|&])/.exec(command.slice(i));
      if (dup) {
        i += dup[0].length;
      } else {
        // `>&file` and `>|` fail below: a lone `&`, or a segment end with the target pending.
        redirectTarget = "output";
        i += next === ">" ? 2 : 1;
      }
    } else if (c === "<") {
      if (redirectTarget !== undefined || "(<>&".includes(next)) return undefined;
      finishWord();
      redirectTarget = "input";
      i++;
    } else if (c === "`" || c === "(" || c === ")" || (c === "$" && EXPANDS.test(next))) {
      return undefined;
    } else {
      if (group && c === "." && next === ".") return undefined; // a range
      if ("*?[".includes(c)) segmentGlobbed = true;
      if (c === "{") {
        if (group) return undefined; // nested braces
        group = [""];
      } else if (group && c === ",") {
        group.push("");
      } else if (group && c === "}") {
        // Without a comma it's plain text, like `@{u}`.
        if (group.length === 1) currentWord += `{${group[0]}}`;
        else {
          wordParts.push(currentWord, group);
          currentWord = "";
        }
        group = undefined;
      } else if (group) {
        group[group.length - 1] += c;
      } else {
        currentWord += c;
      }
      wordStarted = true;
      i++;
    }
  }
  finishSegment();
  return unsafe ? undefined : { segments, globbed };
}

/**
 * The words a word of text and brace groups expands to, in bash's order: `a{b,c}{1,2}` is `ab1 ab2 ac1 ac2`. Bash
 * drops empty results from braces, so `x{,y}` is `x xy` and `{,}` is nothing; a word with no group, like `''`, stays
 * as is. Undefined when there would be more than `MAX_BRACE_WORDS`.
 */
function expandBraces(parts: (string | string[])[]): string[] | undefined {
  let words = [""];
  for (const part of parts) {
    words = typeof part === "string" ? words.map((w) => w + part) : words.flatMap((w) => part.map((p) => w + p));
    if (words.length > MAX_BRACE_WORDS) return undefined;
  }
  return parts.some((p) => typeof p !== "string") ? words.filter((w) => w !== "") : words;
}

/** A `-abc` word: one dash, then short flags. */
function isShortFlags(w: string) {
  return /^-[^-]/.test(w);
}

/** True when a short-flag word holds any of `letters`, since `-ro` is `-r -o`. */
function hasShort(args: string[], letters: string) {
  return args.some((w) => isShortFlags(w) && [...w.slice(1)].some((c) => letters.includes(c)));
}

/**
 * True when a word is one of the long flags `names`, in full or abbreviated, with or without `=value`: GNU getopt and
 * git both accept `--out` for `--output`. A longer flag (`--pre-glob` for `--pre`) doesn't match.
 */
function hasLong(args: string[], names: string[]) {
  return args.some((w) => {
    const flag = w.split("=")[0] ?? "";
    return names.some((n) => flag.length > 2 && n.startsWith(flag));
  });
}

/** Words that aren't flags. `-` alone is stdin, an operand. */
function operands(args: string[]) {
  return args.filter((w) => w === "-" || !w.startsWith("-"));
}

/**
 * The list form of `git branch` or `git tag`: every flag is one of `shorts` or `longs` (with or without `=value`), and
 * operands, which would name a branch or tag to create, are allowed only with `-l` or `--list`, where they're patterns.
 */
function listOnly(shorts: string, longs: string[]): ArgCheck {
  return (args) => {
    const flagsOk = args.every((w) => {
      if (w === "-" || !w.startsWith("-")) return true;
      if (isShortFlags(w)) return [...w.slice(1)].every((c) => shorts.includes(c));
      return longs.includes(w.split("=")[0] ?? "");
    });
    const listing = args.includes("--list") || hasShort(args, "l");
    return flagsOk && (listing || operands(args).length === 0);
  };
}

/**
 * `git` reads only: a read subcommand and no `--output`. A global option (`-c`, `-C`, `-p`, …) sits where the
 * subcommand goes, so it never matches one. `--no-pager` is skipped: agents add it often, and it only turns the pager
 * off.
 */
function git(words: string[]): boolean {
  const [sub = "", ...args] = words[0] === "--no-pager" ? words.slice(1) : words;
  return !hasLong(args, ["--output"]) && (GIT_SUBCOMMANDS.get(sub)?.(args) ?? false);
}

/** `sed -n 'Np'` or `sed -n 'N,Mp'` (`$` for the last line), then files. Rejects `w`, `-i`, `-e`, …. */
function sed([n, script = "", ...files]: string[]): boolean {
  return n === "-n" && /^(\d+|\$)(,(\d+|\$))?p$/.test(script) && files.every((f) => !f.startsWith("-"));
}
