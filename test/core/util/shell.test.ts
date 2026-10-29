import { describe, expect, it } from "vitest";
import { isReadOnlyCommand, isReadOnlyCommandWithChecks, tokenize } from "#core/util/shell";

describe("tokenize", () => {
  it.each([
    ["cat a | grep b && wc -l; pwd", [["cat", "a"], ["grep", "b"], ["wc", "-l"], ["pwd"]]],
    ["a || b\nc", [["a"], ["b"], ["c"]]],
    ["echo 'a; b' \"c | d\"", [["echo", "a; b", "c | d"]]],
    ["ca't' x", [["cat", "x"]]],
    ["echo '' x", [["echo", "", "x"]]],
    ['echo "a\\"b" \\$x', [["echo", 'a"b', "$x"]]],
    ['echo "\\n"', [["echo", "\\n"]]],
    ["ls \\\n  -la", [["ls", "-la"]]],
    ["cat < in.txt", [["cat"]]],
    ["ls > /dev/null 2>&1", [["ls"]]],
    ["echo x >&2", [["echo", "x"]]],
    ["ls ;", [["ls"]]],
    ['grep a$ "b$"', [["grep", "a$", "b$"]]],
    ["wc -l docs/{cli,settings}.md", [["wc", "-l", "docs/cli.md", "docs/settings.md"]]],
    ["echo {a,b}{1,2}", [["echo", "a1", "a2", "b1", "b2"]]],
    ["echo x{,y} {,}", [["echo", "x", "xy"]]],
    ["echo {a, b} @{u}", [["echo", "{a,", "b}", "@{u}"]]],
    ["", []],
  ])("splits %j", (command, expected) => {
    expect(tokenize(command)?.map((segment) => segment.words)).toEqual(expected);
  });

  it.each([
    ["cat < in.txt", [{ words: ["cat"], inputs: ["in.txt"] }]],
    [
      "< ~/a; wc -l <b",
      [
        { words: [], inputs: ["~/a"] },
        { words: ["wc", "-l"], inputs: ["b"] },
      ],
    ],
    ["ls > /dev/null", [{ words: ["ls"], inputs: [] }]],
  ])("keeps the files %j reads with <", (command, expected) => {
    expect(tokenize(command)).toEqual(expected);
  });

  it.each([
    ["command substitution", "echo $(whoami)"],
    ["arithmetic", "echo $((1+1))"],
    ["backticks", "echo `whoami`"],
    ["substitution in double quotes", 'echo "$(whoami)"'],
    ["backticks in double quotes", 'echo "`whoami`"'],
    ["ANSI-C quoting", "find . $'-delete'"],
    ["locale quoting", 'find . $"-delete"'],
    ["a variable, which can hold a flag", "find . $FLAG"],
    ["a variable in double quotes", 'find . "$FLAG"'],
    ["a positional parameter", "find . $1"],
    ["brace expansion with a range", "echo {a..c}"],
    ["nested braces", "echo {a,{b,c}}"],
    ["quotes inside braces", "echo {a,'b'}"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash parameter expansion, not a template.
    ["a comma in a parameter expansion", "echo ${x,,}"],
    ["braces in a redirect target", "cat < {a,b}"],
    ["too many brace words", `echo ${"{a,b}".repeat(9)}`],
    ["process substitution in", "diff <(ls) b"],
    ["process substitution out", "ls >(cat)"],
    ["a subshell", "(ls)"],
    ["a background job", "ls & rm x"],
    ["a redirect to a file", "ls > out"],
    ["an append", "ls >> out"],
    ["an fd redirect to a file", "ls 2> err"],
    ["a clobber redirect", "ls >| out"],
    ["&>", "ls &> out"],
    [">&file", "ls >&out"],
    ["read-write open", "cat <> f"],
    ["a heredoc", "cat <<EOF\nx\nEOF"],
    ["a dangling redirect", "ls >"],
    ["a dangling input redirect", "cat <"],
    ["an unterminated single quote", "echo 'a"],
    ["an unterminated double quote", 'echo "a'],
    ["a trailing backslash", "ls \\"],
  ])("returns undefined on %s", (_, command) => {
    expect(tokenize(command)).toBeUndefined();
  });
});

describe("isReadOnlyCommand", () => {
  // Pi's plan-mode example runs all of these without asking.
  it.each([
    ["find -delete", "find . -name '*.tmp' -delete"],
    ["find -{delete,…}", "find . -{delete,name}"],
    // A file named `-delete` in the cwd makes `*` expand to it.
    ["a glob on a checked reader", "find *"],
    ["a glob in a brace", "sed -n 1p {a,*}"],
    ["awk system()", "awk 'BEGIN{system(\"rm -rf x\")}'"],
    ["curl -o", "curl -o out https://example.com"],
    ["sort -o", "sort -o out in.txt"],
    ["git diff --output=", "git diff --output=out.patch"],
    ["sed -n '1w …'", "sed -n '1w out' in.txt"],
    ["rg --pre", "rg --pre ./script pattern"],
    ["$(…)", "ls $(rm x)"],
    ["xargs sh -c", "find . | xargs sh -c 'rm x'"],
    ["env node", "env node -e 'process.exit()'"],
    ["ls; node …", "ls; node script.js"],
    ["git branch <name>", "git branch new-branch"],
  ])("asks on %s", (_, command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });

  it.each([
    "ls -la",
    "pwd",
    "cat a.txt | grep foo | wc -l",
    "grep -n foo src/*.ts; find . -type f",
    "wc -l docs/{cli,settings,models}.md",
    "grep -rn foo src 2>/dev/null | head -20",
    "grep -q foo README.md >/dev/null",
    "echo 'a; rm b'",
    "tree -L 2",
    "file a.png",
    "find . -name '*.ts' -type f",
    "fd -e ts src",
    "rg -n --pre-glob '*.gz' foo",
    "sort -rn a.txt | uniq -c",
    "uniq a.txt",
    "sed -n '1,20p' a.txt",
    "sed -n '$p' a.txt",
    "sed -n 5p",
    "sed -n '15,45p;100,130p' a.txt",
    "sed -n '/a/,/b/p' a.txt",
    "sed -n '/a/,/b/p;1,3p' a.txt",
    "cat a | sed -n '/a/,/b/p'",
    "rg -n foo || true",
    "rg -n foo src || :",
    "git status && git log --oneline -5",
    "git --no-pager diff HEAD~1",
    "git -C frontend status --short --branch",
    "git -Cfrontend log -1",
    "git --git-dir=.git log -1",
    "git --work-tree . status",
    "git --no-pager -C frontend diff --stat",
    "git show HEAD:src/a.ts",
    "git log @{u}..HEAD",
    "git grep -n foo",
    "git branch",
    "git branch -avv",
    "git branch --show-current",
    "git branch --list 'feat*'",
    "git tag",
    "git tag -l 'v*'",
    "git tag -n3",
    "git remote",
    "git remote -v",
    "git remote get-url origin",
    "git stash list",
    "git stash show -p stash@{0}",
    "git --version",
    "git version --build-options",
    "git worktree list",
    "git worktree list --porcelain -z",
    "git config --get user.name",
    "git config -l",
    "git config get user.name",
    "npm ls --depth=0",
    "npm view vitest version",
    "cd",
    "cd src && rg -n foo . | head -50",
    "cd /p && sed -n '35,55p' a.ts && echo '---' && sed -n 5p b.ts",
  ])("allows %j", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    ["an empty command", ""],
    ["an unknown command", "node x.js"],
    ["a quoted unknown command", "'rm' x"],
    ["a path to a reader", "/bin/cat a"],
    ["an env assignment", "FOO=1 cat a"],
    ["an Object.prototype name", "toString"],
    ["a wrapper", "timeout 5 ls"],
    ["sudo", "sudo ls"],
    ["a later bad segment", "ls && rm x"],
    ["a writer after cd", "cd /p && touch x"],
    ["cd to a command's output", "cd $(echo /p) && ls"],
    ["tee", "ls | tee out"],
    ["tree -o", "tree -o out"],
    ["tree with o in a cluster", "tree -ao out"],
    ["file -C", "file -C -m magic"],
    ["find -exec", "find . -exec rm {} ;"],
    ["find -execdir", "find . -execdir rm x ;"],
    ["find -ok", "find . -ok rm x ;"],
    ["find -fprint", "find . -fprint out"],
    ["find -fls", "find . -fls out"],
    ["fd -x", "fd -e ts -x rm"],
    ["fd with X in a cluster", "fd -HX rm"],
    ["fd --exec-batch", "fd --exec-batch rm"],
    ["rg --pre=", "rg --pre=./script foo"],
    ["rg --hostname-bin", "rg --hostname-bin=./script foo"],
    ["sort -o after operands", "sort in.txt -o out"],
    ["sort with o in a cluster", "sort -ro out in.txt"],
    ["sort --output abbreviated", "sort --out=out in.txt"],
    ["sort --compress-program", "sort --compress-program=./x in.txt"],
    ["uniq with an output file", "uniq in.txt out.txt"],
    ["uniq from stdin to a file", "uniq - out.txt"],
    ["sed without -n", "sed '1p' a"],
    ["sed with a write command", "sed -n '1p;w out' a"],
    ["sed with a range write", "sed -n '/a/,/b/w out' a"],
    ["sed with an execute command", "sed -n '/a/e date' a"],
    ["sed mixing print and write", "sed -n '1,5p;s/a/b/w x' a"],
    ["sed with a step address", "sed -n '1~2p' a"],
    ["sed with a relative address", "sed -n '1,+5p' a"],
    ["a bare true", "true"],
    ["sed -i after operands", "sed -n 1p a -i"],
    ["sed -e", "sed -n -e 1p a"],
    ["git with -c", "git -c core.pager=./x log"],
    ["git with no subcommand", "git"],
    ["git -C with a writing subcommand", "git -C frontend commit -m x"],
    ["git -C with no subcommand", "git -C frontend"],
    ["git -C and --output", "git -C frontend log --output out"],
    ["git -C before another global option", "git -C frontend -c core.pager=./x log"],
    ["git --git-dir with no value", "git --git-dir"],
    ["a writing git subcommand", "git commit -m x"],
    ["git diff --output after a space", "git diff --output out"],
    ["git log --output abbreviated", "git log --out=out"],
    ["git grep -O", "git grep -O./x foo"],
    ["git grep with O in a cluster", "git grep -nO foo"],
    ["git grep --open-files-in-pager", "git grep --open-files-in-pager=./x foo"],
    ["git branch -D", "git branch -D old"],
    ["git branch -m", "git branch -m a b"],
    ["git branch --set-upstream-to", "git branch --set-upstream-to=origin/main"],
    ["git branch with a commit operand", "git branch --contains abc"],
    ["git tag <name>", "git tag v1"],
    ["git tag -d", "git tag -d v1"],
    ["git remote add", "git remote add x https://example.com"],
    ["a bare git stash", "git stash"],
    ["git stash pop", "git stash pop"],
    ["git worktree add", "git worktree add ../wt -b wt"],
    ["git worktree remove", "git worktree remove ../wt"],
    ["git worktree list with an operand", "git worktree list --expire 2.weeks"],
    ["git config set", "git config user.name x"],
    ["git config --get with --unset", "git config --get x --unset"],
    ["git config --edit", "git config --list --edit"],
    ["npm install", "npm install x"],
    ["npm run", "npm run build"],
    ["npm test", "npm test"],
    ["npm with a global flag first", "npm --prefix x ls"],
  ])("asks on %s", (_, command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });
});

describe("isReadOnlyCommandWithChecks", () => {
  const checks = ["npm run lint", "npm test -- --run", "npm run build"];
  const allows = (command: string) => isReadOnlyCommandWithChecks(command, checks, "/project");

  it.each([
    "npm run lint",
    "npm run lint && npm test -- --run && npm run build",
    "git status && npm run lint",
    "cd frontend && npm run lint",
    "cd frontend && cd src && npm run lint",
    "cd /project/sub && npm run lint",
    "npm test -- --run src/a.test.ts",
    "TZ=UTC npm test -- --run",
    "cd frontend && TZ=UTC npm test -- --run a.test.ts",
  ])("allows %j", (command) => {
    expect(allows(command)).toBe(true);
  });

  it.each([
    ["cd ..", "cd .. && npm run lint"],
    ["cd /tmp", "cd /tmp && npm run lint"],
    ["cd /project-other", "cd /project-other && npm run lint"],
    ["cd /project/..", "cd /project/../x && npm run lint"],
    ["cd /project/sub/../..", "cd /project/sub/../../x && npm run lint"],
    ["cd -", "cd - && npm run lint"],
    ["cd ~", "cd ~ && npm run lint"],
    ["another flag on a check", "npm test -- --run --reporter=dot"],
    ["--fix on a check", "npm run lint -- --fix"],
    ["a glob on a check", "npm test -- --run src/*.test.ts"],
    ["an output redirect", "npm run lint > out.txt"],
    ["words a check doesn't start with", "npx vitest run src/a.test.ts"],
    ["a check the user didn't approve", "npm test"],
    ["a noop after a check", "npm run lint || true"],
    ["a writer after a check", "npm run lint && npm install"],
  ])("refuses %s", (_, command) => {
    expect(allows(command)).toBe(false);
  });
});
