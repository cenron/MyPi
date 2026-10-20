/**
 * Splits a bash command into segments (split on `|`, `||`, `&&`, `;` and newlines) of words with their quotes
 * removed, or returns undefined when the command holds syntax that can run or write something the words don't show:
 * `$(`, backticks, `<(`, `>(`, `(`, a lone `&`, `$'…'`, brace expansion, or a redirect other than `N>&M`,
 * `>/dev/null` and `< file`. Redirect targets are dropped from the words.
 */
export function tokenize(command: string): string[][] | undefined {
  const segments: string[][] = [];
  let segmentWords: string[] = [];
  let currentWord = "";
  let wordStarted = false; // A quote starts a word too, so '' is preserved.
  let braceDepth = 0; // unquoted `{` in the current word
  let redirectTarget: "input" | "output" | undefined;
  let unsafeRedirect = false;

  const finishWord = () => {
    if (!wordStarted) return;
    if (redirectTarget === "output" && currentWord !== "/dev/null") unsafeRedirect = true;
    if (redirectTarget === undefined) segmentWords.push(currentWord);
    currentWord = "";
    wordStarted = false;
    braceDepth = 0;
    redirectTarget = undefined;
  };

  const finishSegment = () => {
    finishWord();
    if (redirectTarget !== undefined) unsafeRedirect = true; // A redirect needs a target.
    if (segmentWords.length > 0) segments.push(segmentWords);
    segmentWords = [];
  };

  let i = 0;
  while (i < command.length) {
    const c = command.charAt(i);
    const next = command.charAt(i + 1);

    if (c === "'") {
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
        // Command substitution still runs inside double quotes.
        if (d === "`" || (d === "$" && command.charAt(i + 1) === "(")) return undefined;
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
      if (wordStarted && /^\d+$/.test(currentWord)) {
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
    } else if (c === "`" || c === "(" || c === ")" || (c === "$" && (next === "(" || next === "'"))) {
      return undefined;
    } else {
      // Brace expansion turns `-{delete,x}` into `-delete -x`, so a comma or `..` inside braces asks.
      if (c === "{") braceDepth++;
      else if (c === "}" && braceDepth > 0) braceDepth--;
      else if (braceDepth > 0 && (c === "," || (c === "." && next === "."))) return undefined;
      currentWord += c;
      wordStarted = true;
      i++;
    }
  }
  finishSegment();
  return unsafeRedirect ? undefined : segments;
}

/**
 * True only for a command that can't write files or run another program, so Plan can run it without asking. Strict on
 * purpose: a false only costs a confirm. Every segment's first word must be a known reader whose arguments pass its
 * check; anything else, wrappers like `env` and `xargs` included, is false.
 */
export function isReadOnlyCommand(command: string): boolean {
  const segments = tokenize(command);
  if (segments === undefined || segments.length === 0) return false;
  return segments.every(([name = "", ...args]) => READERS.get(name)?.(args) ?? false);
}

type ArgCheck = (args: string[]) => boolean;

/** A `-abc` word: one dash, then short flags. */
const isShortFlags = (w: string) => /^-[^-]/.test(w);

/** True when a short-flag word holds any of `letters`, since `-ro` is `-r -o`. */
const hasShort = (args: string[], letters: string) =>
  args.some((w) => isShortFlags(w) && [...w.slice(1)].some((c) => letters.includes(c)));

/**
 * True when a word is one of the long flags `names`, in full or abbreviated, with or without `=value`: GNU getopt and
 * git both accept `--out` for `--output`. A longer flag (`--pre-glob` for `--pre`) doesn't match.
 */
const hasLong = (args: string[], names: string[]) =>
  args.some((w) => {
    const flag = w.split("=")[0] ?? "";
    return names.some((n) => flag.length > 2 && n.startsWith(flag));
  });

/** Words that aren't flags. `-` alone is stdin, an operand. */
const operands = (args: string[]) => args.filter((w) => w === "-" || !w.startsWith("-"));

/**
 * The list form of `git branch` or `git tag`: every flag is one of `shorts` or `longs` (with or without `=value`), and
 * operands, which would name a branch or tag to create, are allowed only with `-l` or `--list`, where they're patterns.
 */
const listOnly =
  (shorts: string, longs: string[]): ArgCheck =>
  (args) => {
    const flagsOk = args.every((w) => {
      if (w === "-" || !w.startsWith("-")) return true;
      if (isShortFlags(w)) return [...w.slice(1)].every((c) => shorts.includes(c));
      return longs.includes(w.split("=")[0] ?? "");
    });
    const listing = args.includes("--list") || hasShort(args, "l");
    return flagsOk && (listing || operands(args).length === 0);
  };

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

/**
 * `git` reads only: a read subcommand and no `--output`. A global option (`-c`, `-C`, `-p`, …) sits where the
 * subcommand goes, so it never matches one. `--no-pager` is skipped: agents add it often, and it only turns the pager
 * off.
 */
const git: ArgCheck = (words) => {
  const [sub = "", ...args] = words[0] === "--no-pager" ? words.slice(1) : words;
  return !hasLong(args, ["--output"]) && (GIT_SUBCOMMANDS.get(sub)?.(args) ?? false);
};

/** `sed -n 'Np'` or `sed -n 'N,Mp'` (`$` for the last line), then files. Rejects `w`, `-i`, `-e`, …. */
const sed: ArgCheck = ([n, script = "", ...files]) =>
  n === "-n" && /^(\d+|\$)(,(\d+|\$))?p$/.test(script) && files.every((f) => !f.startsWith("-"));

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
  ["npm", ([sub = ""]) => ["ls", "list", "view", "info", "outdated"].includes(sub)],
]);
