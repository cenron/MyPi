import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { commandPaths, isInside, resolveToolPath } from "#core/util/paths";
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
    ["the raw text's redirect targets and assignments", "ls > /tmp/out; X=../y cmd", ["/tmp/out", "/home/me/work/y"]],
    ["a raw < target glued to its path", "cat </etc/hosts $(x)", ["/etc/hosts"]],
    ["a quoted path in the raw text, by its value", 'cmd "--file=/etc/x" "$X"', ["/etc/x"]],
    ["a path a heredoc script names", "python3 - <<'PY'\nopen('/etc/passwd')\nPY", ["/etc/passwd"]],
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
    ["tags in a heredoc's markup", "cat > page.html <<'EOF'\n<div><b>x</b></div>\nEOF"],
  ])("names nothing for %s", (_case, command) => {
    expect(commandPaths(command, commandCwd, commandHome)).toEqual([]);
  });
});
