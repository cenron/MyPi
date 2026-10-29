import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { commandPaths, displayPath, hasExistingRoot, isInside, resolveToolPath } from "#core/util/paths";
// pi doesn't export resolveToCwd, so the parity test reaches into its dist. A pi upgrade that changes it fails here.
import { resolveToCwd } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js";

const cwd = "/project";
const home = "/home/me";

describe("resolveToolPath", () => {
  it.each([
    ["notes.md", "/project/notes.md"],
    ["./a/../b.md", "/project/b.md"],
    ["../outside.md", "/outside.md"],
    ["/abs/../x.md", "/x.md"],
    ["@src/a.ts", "/project/src/a.ts"],
    ["~", "/home/me"],
    ["~/x.md", "/home/me/x.md"],
    ["@~/x.md", "/home/me/x.md"],
    ["~user/x.md", "/project/~user/x.md"],
    ["file:///tmp/x.md", "/tmp/x.md"],
    ["a b c.md", "/project/a b c.md"],
  ])("resolves %j to %s, as pi's resolveToCwd does", (input, expected) => {
    expect(resolveToolPath(input, cwd, home)).toBe(expected);
    expect(resolveToolPath(input, cwd, homedir())).toBe(resolveToCwd(input, cwd));
  });

  it("strips only one @", () => {
    expect(resolveToolPath("@@x", cwd, home)).toBe("/project/@x");
  });
});

describe("isInside", () => {
  const plans = "/project/.pi/plans";

  it.each([
    [plans, true],
    [`${plans}/a.md`, true],
    [`${plans}/..notes.md`, true],
    [`${plans}-evil/a.md`, false],
    ["/project/.pi", false],
    ["/project/a.md", false],
    [`${plans}/../a.md`, false],
  ])("%s is inside: %s", (path, expected) => {
    expect(isInside(plans, path)).toBe(expected);
  });
});

const commandCwd = "/home/me/work/app";
const commandHome = "/home/me";

describe("commandPaths", () => {
  it.each([
    ["an absolute path", "cat /etc/hosts", ["/etc/hosts"]],
    ["~ and ~/", "ls ~ ~/notes", ["/home/me", "/home/me/notes"]],
    ["the parent folder", "find .. -name AGENTS.md", ["/home/me/work"]],
    ["a word starting with ../", "cat ../other/a.ts", ["/home/me/work/other/a.ts"]],
    ["a .. step later in the word", "cat ./../x src/../../y", ["/home/me/work/x", "/home/me/work/y"]],
    ["a .. step that stays inside", "cat src/../README.md", ["/home/me/work/app/README.md"]],
    ["a name=value word, by its value", "dd if=/dev/disk0 of=out --log=~/l", ["/dev/disk0", "/home/me/l"]],
    ["a file:// URL", "curl file:///etc/passwd", ["/etc/passwd"]],
    ["a < target, whatever its shape", "wc -l < notes.txt", ["/home/me/work/app/notes.txt"]],
    ["quoted and braced words, as bash sees them", "cat '/a b' /x/{c,d}", ["/a b", "/x/c", "/x/d"]],
    ["words in every segment", "ls /a | grep x && cat /b", ["/a", "/b"]],
    ["herdr pane send-text forwards text", "herdr pane send-text wN:p5 '/plan build'", []],
    ["herdr agent prompt forwards text", 'herdr agent prompt todo-check "/plan implement .pi/plans/x.md" --wait', []],
    ["herdr send-text still checks < targets", "herdr pane send-text wN:p5 '/reload' < /etc/passwd", ["/etc/passwd"]],
    // An output redirect makes tokenize give up; the raw split then checks the text like any word.
    [
      "herdr send-text with a > falls back to the raw split",
      "herdr pane send-text wN:p5 '/reload' > /etc/x",
      ["/reload", "/etc/x"],
    ],
    ["a redirect-looking payload stays opaque", "herdr pane send-text wN:p5 'echo > /etc/x'", []],
    ["other herdr commands still check paths", "herdr pane read wN:p5 /etc/hosts", ["/etc/hosts"]],
    ["the cd target", "cd sub && ls", ["/home/me/work/app/sub"]],
    ["a bare cd, which goes home", "cd && ls", ["/home/me"]],
    ["cd's options skipped", "cd -P /x", ["/x"]],
    [
      "later words resolved from the cd target",
      "cd sub && cat ../../x < ../in",
      ["/home/me/work/app/sub", "/home/me/work/app/in", "/home/me/work/x"],
    ],
    ["the previous folder of cd - (not followed)", "cd - && cat ../x", ["/home/me/work/x"]],
    [
      "the raw text when tokenize gives up, with $HOME",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash variable, not a template.
      'cat $(ls /etc) "$HOME/.ssh" ${HOME}',
      ["/etc", "/home/me/.ssh", "/home/me"],
    ],
    // Found in job-search-hub (2026-10-28): the raw text lost the `cd`, naming a place nothing reaches.
    [
      "a cd before a command the parser gives up on",
      'cd frontend && cat ../shared/x.ts "$X"',
      ["/home/me/work/app/frontend", "/home/me/work/app/shared/x.ts"],
    ],
    [
      "a cd's folder, then a path above the project",
      'cd frontend && cat ../../x "$X"',
      ["/home/me/work/app/frontend", "/home/me/work/x"],
    ],
    [
      "a cd after another command",
      'npx x && cd frontend && cat ../shared/x.ts "$X"',
      ["/home/me/work/app/frontend", "/home/me/work/app/shared/x.ts"],
    ],
    [
      "a cd, then a heredoc a program runs",
      "cd frontend && python3 - <<'PY'\nopen('../shared/x.ts')\nPY",
      ["/home/me/work/app/frontend", "/home/me/work/app/shared/x.ts"],
    ],
    // The raw text can't tell where these go, so they leave the folder alone.
    [
      "a cd whose target is a variable (not followed)",
      'cd "$DIR" && cat ../shared/x.ts',
      ["/home/me/work/shared/x.ts"],
    ],
    ["cd - in the raw text (not followed)", 'cd - && cat ../shared/x.ts "$X"', ["/home/me/work/shared/x.ts"]],
    // A cd-shaped word later in a command is text, not a `cd`; a bare cd still goes home.
    [
      "a cd-shaped word that isn't the command (not followed)",
      'echo cd frontend && cat ../shared/x.ts "$X"',
      ["/home/me/work/shared/x.ts"],
    ],
    ["a bare cd in the raw text", 'cd && cat ../x "$X"', ["/home/me", "/home/x"]],
    ["the raw text's redirect targets and assignments", "ls > /tmp/out; X=../y cmd", ["/tmp/out", "/home/me/work/y"]],
    ["a raw < target glued to its path", "cat </etc/hosts $(x)", ["/etc/hosts"]],
    ["a quoted path in the raw text, by its value", 'cmd "--file=/etc/x" "$X"', ["/etc/x"]],
    ["a path a heredoc script names", "python3 - <<'PY'\nopen('/etc/passwd')\nPY", ["/etc/passwd"]],
    // A heredoc that runs is a command, and one bash expands isn't only text yet.
    ["a specifier in code the heredoc runs", "node <<'EOF'\nrequire('../../libs/x')\nEOF", ["/home/me/libs/x"]],
    ["a shell heredoc that runs and redirects", "bash <<'EOF' > out.log\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    ["a heredoc expanded before a writer sees it", "cat > src/a.ts <<EOF\n$(cat /etc/passwd)\nEOF", ["/etc/passwd"]],
    ["a heredoc piped into a shell", "cat <<'EOF' | sh\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    ["a heredoc a program runs", "python3 - > out.ts <<'EOF'\nopen('/etc/passwd')\nEOF", ["/etc/passwd"]],
    // A script written and run in one call still names the paths it runs against.
    [
      "a written script run in the same call",
      "cat > run.sh <<'EOF'\ncat ~/.ssh/id\nEOF\nbash run.sh",
      ["/home/me/.ssh/id"],
    ],
    [
      "a written script run from the opener line",
      "cat > run.sh <<'EOF' && bash run.sh\ncat ~/.ssh/id\nEOF",
      ["/home/me/.ssh/id"],
    ],
    // A program the line names takes the body: another command, or a process substitution on either side.
    ["a chained command after the writer", "cat a && bash <<'EOF'\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    ["a second command before the writer", "echo hi; python3 - <<'EOF'\nopen('/etc/passwd')\nEOF", ["/etc/passwd"]],
    ["a process substitution in the writer's command", "tee >(bash) <<'EOF'\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    ["a process substitution as the redirect target", "cat > >(sh) <<'EOF'\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    ["a process substitution after the marker", "cat <<'EOF' > >(sh)\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    // A pipe glued to the redirect hands the body to `sh`, which runs it.
    ["a pipe glued to the marker's redirect", "cat <<'EOF' >&1|sh\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    [
      "a pipe glued to a redirect target",
      "cat <<'EOF' >/dev/stdout|sh\ncat ~/.ssh/id\nEOF",
      ["/dev/stdout", "/home/me/.ssh/id"],
    ],
    ["sed's file, past -e scripts", "sed -e '/x/d' -e 's/a/b/' /etc/hosts", ["/etc/hosts"]],
    ["sed's file, past a -ne script", "sed -ne 's/a/b/p' /etc/hosts", ["/etc/hosts"]],
    ["sed's file, past its first-operand script", "sed 's/a/b/' /etc/hosts", ["/etc/hosts"]],
    ["sed's -f script file", "sed -f /etc/x.sed in.txt", ["/etc/x.sed"]],
    ["a path in a shell heredoc", "bash <<'EOF'\ncat ~/.ssh/id\nEOF", ["/home/me/.ssh/id"]],
    // An apostrophe in a comment pairs with the next quote; that span has spaces, so it's split, and the path stays.
    ["a path after a stray apostrophe", "python3 - <<'PY'\n# don't\nopen('/etc/passwd')\nPY", ["/etc/passwd"]],
    ["a quoted path with spaces and an operator", "cat '/a b|c'", ["/a b|c"]],
    ["the real path next to a pattern", "grep -E '/a/|/b/' /etc/x || test \"$?\" -eq 1", ["/etc/x"]],
  ])("names %s", (_case, command, expected) => {
    expect(commandPaths(command, commandCwd, commandHome)).toEqual(expected);
  });

  it.each([
    ["plain relative words", "cat src/a.ts README.md"],
    ["flags and URLs", "curl -sL https://example.com/a/../b"],
    ["a $HOME that's part of a longer name", "echo $HOMEBREW_PREFIX"],
    ["~user, which isn't the home folder", "ls ~root"],
    // Found in a worktree spike: each of these asked about a place nobody reaches.
    ["a quoted pattern that starts with /", "git diff | grep -E '/Users/|/private/'"],
    ["the same pattern when tokenize gives up", "git diff | grep -E '/Users/|/private/' || test \"$?\" -eq 1"],
    ["a tag in a heredoc script's regex", "python3 - <<'PY'\nre.findall(r'<cwd>.*?</cwd>', s)\nPY"],
    // A heredoc a plain writer takes is the file's content or output, not a command: its code names no place.
    ["an import in the file a heredoc writes", "cat > src/a.ts <<'EOF'\nimport { x } from '../../libs/x';\nEOF"],
    [
      "the same with an unquoted delimiter and nothing to expand",
      "cat > src/a.ts <<EOF\nimport { x } from '../../libs/x';\nEOF",
    ],
    ["a tee'd file", "tee src/a.ts <<'EOF'\nimport { x } from '../../libs/x';\nEOF"],
    ["tags in a heredoc's markup", "cat > page.html <<'EOF'\n<div><b>x</b></div>\nEOF"],
    // Found building analytics with DeepSeek (2026-10-26): each asked about a place nobody reaches.
    ["a sed address range that starts with /", "herdr pane read x | sed -n '/Model usage/,$p' | head -55"],
    ["symbols alone in a heredoc's code", "python3 - <<'EOF'\nprint(a / b)\nx = '/**'\nEOF"],
  ])("names nothing for %s", (_case, command) => {
    expect(commandPaths(command, commandCwd, commandHome)).toEqual([]);
  });
});

describe("hasExistingRoot", () => {
  it.each([
    ["an existing top-level folder", "/etc/passwd", ["etc", "Users"], true],
    ["a missing top-level folder", "/quiet", ["etc", "Users"], false],
    ["the root itself", "/", ["etc", "Users"], true],
  ])("checks %s", (_case, path, entries, expected) => {
    expect(hasExistingRoot(path, entries)).toBe(expected);
  });
});

describe("displayPath", () => {
  it.each([
    ["relative inside the folder", "/project/src/a.ts", "src/a.ts"],
    ["absolute outside it", "/elsewhere/a.ts", "/elsewhere/a.ts"],
  ])("is %s", (_case, file, shown) => {
    expect(displayPath(file, "/project")).toBe(shown);
  });
});
