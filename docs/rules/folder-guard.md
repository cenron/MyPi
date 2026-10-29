# Folder guard

**Status:** done (slices 1–3 done 2026-10-24, slices 4–6 done 2026-10-25, slices 7–9 done 2026-10-26 to 2026-10-29)

A built-in rule, not a module: it's always on, in every session (decided 2026-10-24). The code is
`src/rule/folder.ts`.

## Goal

Ask before any tool call reaches outside the session's folder. In a live test (2026-10-24), pi started in
`~/Documents/workspace/pi-workspace` ran `find .. -name AGENTS.md`, then `find /Users/radni/Documents -maxdepth 5 …`
and `find /Users/radni -maxdepth 5 …` looking for an existing "todo" project. Nothing stopped it: Build runs any
command, and Plan's rule lets `find` and `ls` run anywhere because they only read. Reading is still looking, and the
user's other projects and personal files are none of the agent's business unless the user says so.

## Behavior

- **Ask, in both modes.** A call that names a path outside the session's folder opens the permission dialog: Yes, No,
  or "Allow for this session". No UI means a block, with the reason.
- **Outside** means the path, resolved the way pi resolves tool paths (`resolveToolPath`), isn't inside `ctx.cwd`
  (`isInside`). It compares text, so a symlink inside the folder that points elsewhere counts as inside.
- **The question names the place, not the command:** `Reaches outside <cwd>: <path> (and anything under it)`, one
  question per outside path (an ask carries a list of `questions`). "Allow for this session" allows that path and
  everything under it until `/reload`, across commands and tools: a tree allowed through `bash` is allowed for `read`
  too. Allowing a child does not allow its parent or siblings. Yes allows only the current call. **Home and the
  folders above it, up to `/`, are the exception** ([slice 6](#slices)): their question ends "(this path only)" and
  allowing one covers that path alone, since a tree there would allow nearly everything. Containment is
  lexical, with no disk lookup: allowing a file does not grant its parent directory.
- **Always allowed**, so pi's own work doesn't prompt:
  - the folders modules already declare as theirs (`BaseModule.setWritable`), such as memory's global folder;
  - the skills and context files pi put in the last prompt: each skill's folder (`baseDir`) and each `AGENTS.md` pi
    loaded, read from `before_agent_start`'s `systemPromptOptions`. That's exactly what pi points the agent at,
    wherever it lives (the agent dir, `~/.agents/skills`, a package such as MyPi's `resources/skills`, a project's
    parents), with no folder list to keep in step;
  - **for a call that only reads** (`read`, `grep`, `find`, `ls`, `lsp`, or a `bash` command that passes the
    read-only check), each module's own data folder in pi's agent dir, set with `BaseModule.setReadable`:
    `analytics/`, `done-check/`, `subagents/` (asked for 2026-10-26: MyPi's self-builds kept asking to read its
    own database). Writes there still ask, so the agent can't, say, approve its own check commands. pi's
    `sessions/`, every project's conversations, isn't one.
  - the temp folder (`os.tmpdir()`), where background jobs and `web_fetch` write their output. On macOS that's
    `/var/folders/…/T`, not `/tmp`. Its real path (`/private/var/folders/…/T`) is allowed too: a session started in
    a temp folder runs from the real path, so `..` from it named a folder the guard asked about (found 2026-10-26 in
    every live check in a throwaway repo);
  - `/tmp` and `/private/tmp` (macOS's `/tmp` links there, and the guard compares text): shared scratch space that
    agents reach for by habit ([slice 5](#slices));
  - `/dev/null` and the other `/dev/std*` streams.

  Not the whole agent dir: it holds `auth.json`.
- **pi's opening `AGENTS.md` lookup prompts** (decided 2026-10-24). pi already loads `AGENTS.md` from the session
  folder and its parents into the prompt itself (pi's `docs/configuration.md` § Context files), so the model's own
  `find ..` repeats that work; one "Allow for this session" covers it for the session.

## Which calls it checks

| Tool | Paths checked |
|---|---|
| Any tool with a string `path` input (`read`, `edit`, `write`, `grep`, `find`, `ls`, `lsp`, and later ones), except MCP tools (`mcp__…`) | `path`; none means the session's folder |
| `bash` | Every word that reads as a path: starts with `/`, `~/`, or `file://`, is `~`, or has a `..` step (`..`, `../x`, `./..`, `a/../..`). A word with no spaces that holds `|`, `<`, or `>` can only come from quotes, so it's a pattern or markup (`grep -E '/a/\|/b/'`, `'</cwd>'`), not a path. A `name=value` word (`--file=x`, dd's `if=x`, `VAR=x`) is checked by its value. Other words holding `://` are URLs, not paths. Every `<` target, whatever its shape. Every `cd` target. |
| MCP tools, `web_search`, `web_fetch` | Nothing: they don't take local paths. |

- **Words come from `tokenize`** (`src/core/util/shell.ts`, Plan's shell check), so quotes are removed and comma
  braces expanded. `tokenize` also returns each segment's `<` targets, which it leaves out of the words. When it gives
  up (`$(…)`, variables, redirects to files, heredocs), the raw command is split on spaces, operators, quotes, and
  `=`, and the pieces are checked for the same path shapes, with `$HOME` and `${HOME}` read as `~`. Two exceptions
  keep patterns and markup whole: a quoted string with no spaces is split only on `;`, `&`, parentheses, backticks,
  and `=`, not on `|`, `<`, or `>`; and HTML or XML tags (`<cwd>`, `</cwd>`) are dropped before splitting. A quoted
  span with spaces is split like the rest, so a stray apostrophe in a heredoc can't hide a path inside a long "quoted"
  span. A `cd` at the start of a command in that text moves where later words resolve, as it does in `tokenize`'s, and
  the body of a heredoc only a plain writer takes is left out first: it's data, not a command ([slice 9](#slices)).
  In that split, words of slashes and stars alone (`/`, `/**`) aren't places: in a heredoc's code they divide and
  open comments (seen 2026-10-26, DeepSeek editing files through Python heredocs).
- **`sed`'s scripts aren't paths:** each `-e` value (also in a cluster such as `-ne`), or the first operand when no
  `-e` or `-f` gives one, so an address range like `/Model usage/,$p` isn't asked about; the files after it, and
  `-f`'s script file, are.
- **`cd` counts:** `cd /elsewhere && ls` names `/elsewhere`, a bare `cd` names the home folder, and later words
  resolve from the folder `cd` moved to: `cd sub && cat ../../x` names `<cwd>/../x`. Each bash call starts a new
  shell in the session's folder (pi's `bash.js` spawns one per call), so a `cd` lasts only within one command.

## What it isn't

A guard against wandering, not a sandbox. It sees the paths a call names, not the ones a program computes while it
runs: a script that reads `~/.ssh` without naming it on the command line gets through, as does a variable set
earlier in the session. Real isolation is an OS sandbox's job; see [Not taking](#not-taking).

Known gaps in `bash`, accepted for a guard against wandering:

- **Plain relative words after a `cd` outside.** `cd .. && cat other/notes.md` asks about the parent folder, but
  `other/notes.md` isn't shaped like a path, so once the parent is allowed for the session, the `cat` runs unasked.
  Checking every word after a `cd` would ask about flags and patterns too.
- **`cd -`** goes to the shell's previous folder, which no word names; it isn't followed.
- **A path stuck to a short flag** (`-I/usr/include`, `-o/tmp/x`): see [Not taking](#not-taking).
- **Patterns and markup used to read as paths;** [slice 5](#slices) fixed it. What's left: a tag-shaped redirect
  with no spaces (`cat </etc>out`) loses its target to the tag rule, and a quoted path holding `|`, `<`, or `>` with
  no spaces isn't checked. Both are rare enough to accept.
- **A written heredoc that stays checked.** Its body is left out only when a plain writer at the line's command
  position takes it and the call ends at its closing line. A writer behind another command
  (`mkdir -p dir && cat > f <<'EOF'`), a command chained after the writer (`cat a && bash <<'EOF'`), a process
  substitution on either side (`tee >(bash) <<'EOF'`, `cat <<'EOF' > >(sh)`), a command after the closing line (a
  script written and run in one call), and an unquoted delimiter whose body holds `$` or a backtick still name their
  code's paths; live, a write-then-show call asked (2026-10-29).
- **A `cd` is followed across every separator**, as `segmentPaths` already does: `cd sub | cat ../x`, `cd sub || cat
  ../x`, `cd sub & cat ../x`, and a `cd` that fails before `;` resolve from the `cd`'s folder although bash runs them
  from the old one. Accepted for a guard against wandering.
- **A `cd` whose target is a variable** (`cd "$DIR"`), a backtick, or `-` isn't followed: the raw text can't name
  the folder.
- **Mistyped temp paths still ask** (the guard compares text, and a `T-typo` folder is somewhere else). Reading a
  job's log through the job tools instead of a guessed path is [roadmap](../roadmap.md) row 36, not a guard change.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Rule | `FolderRule` in `src/rule/folder.ts`, a `BaseRule`; `registerRules` (`src/rule/index.ts`) sets it on the guard when `MyPi` starts a session | `info.name` is `folder-guard`, the prefix of its questions. The tool guard merges its ask with Plan's into one dialog, and a block from any rule still wins. |
| Allowed places | `ToolEnv` and the shared `PromptPaths` | `env.writableDirs` carries every module's `setWritable` folders, and `env.readableDirs` its `setReadable` data folders (for calls that only read). The prompt's skill folders and context files are `this.prompt.paths`, the session's one `PromptPaths`, which `updatePromptPaths` (`src/rule/index.ts`) fills from the first run's prompt. The rule adds the temp folder and the `/dev` streams itself. |
| Path words in bash | `commandPaths` in `src/core/util/paths.ts`: `tokenize`, then the raw-text fallback | Pure, with a table test, next to `resolveToolPath` and `isInside`, which it builds on. |

## The lsp module

The guard checks `lsp`'s `path` like any tool's. The module itself also reaches upward on its own: it looks for root
markers (`package.json`, `go.mod`, …) in the folders above a file, and a marker found above the session's folder would
make that folder the server's root and the disk check's scan. So, for a file inside the session's folder, lsp never
roots a server above it: marked folders above the session's folder are skipped, and when none is left the root is the
session's folder (`ServerManager.rootFor`). With `outermostRoot` (gopls) that's the outermost marked folder inside
the session's. A file outside the session's folder, which the user allowed, keeps its own markers. The servers' own lookups (TypeScript
finding a `tsconfig.json` above, say) are theirs and unchanged. See [lsp](../modules/lsp.md#behavior).

## Slices

1. **Done 2026-10-24.** The rule for tools with a `path` input (`FolderRule`), with the always-allowed places. Built
   as a module first, then moved to core the same day: a guard that can be turned off isn't one. Tried live in pi: a `read` outside the folder asks;
   No returns "The user declined this call" and pi asked for access instead of trying another way; "Allow for this
   session" let a later read of the same file run unasked.
2. **Done 2026-10-24.** `bash`: path words and `<` targets from `tokenize`, the raw-text fallback, `cd`. An ask now
   carries a list of questions, so each outside path is its own "Allow for this session". Tried live in pi:
   `cat /etc/hosts /etc/shells` asked with two lines; after "Allow for this session", `head -1 /etc/shells` and
   `wc -l < /etc/hosts` ran unasked; `wc -l < /etc/zshrc`, `cd .. && ls`, and `cat $(echo /etc/passwd) "$HOME/.zshrc"`
   each asked, naming the place; after No, pi didn't try another way.
3. **Done 2026-10-24.** lsp: roots clamped to the session's folder. Tried live: pi started in a project's `src`
   folder, below its `package.json`, ran tsc in `src`.

4. **Done 2026-10-25: "Allow for this session" covers a folder tree.** Found in a live test: pi started in
   `pi-workspace` and working on MyPi in `~/.pi/MyPi` asked again for each file under the folder already allowed,
   because the guard remembers exact ask lines (`ToolGuard.allowed`). Every other harness grants a folder tree (see
   [Other harnesses](#other-harnesses)).
   - **Behavior:** a path allowed for the session also allows every path under it (`isInside(allowed, path)`), for
     every tool, until `/reload`. Allowing `~/.pi/MyPi` lets `~/.pi/MyPi/docs/roadmap.md` run unasked. A file allowed
     covers only itself, since nothing is under a file, so the check stays pure: no `stat` to tell folders from files.
   - **Several paths under one allowed folder** in one call ask nothing; paths under none still ask, one line each.
   - **The question says so:** `Reaches outside <cwd>: <path> (and anything under it)`, for files and folders alike,
     since the rule doesn't look at the disk to tell them apart. Then allowing `..` is plainly allowing every sibling
     project, not a surprise.
   - **The seam:** an ask verdict may return `onAllowSession`, closing over resolved paths rather than parsing
     question text. `ToolGuard` runs each distinct pending callback once, only after "Allow for this session";
     checking alone, Yes, declines, no UI, and winning blocks grant nothing. `FolderRule` stores approved paths in
     memory and includes them in its existing `isInside` check. Exact-line matching remains for every rule,
     including Plan's commands. Fresh session initialization creates a new guard and rule, so `/reload` forgets both.
   - **Verification:** focused tests and `npm run check` pass. Tests cover tree containment, mixed approved/new
     paths, cross-tool access, fresh-session reset, and callback outcomes. Removing the approved trees from the
     allowed list and removing the callback invocation each made their regression tests fail; both were restored.
   - **Tried live 2026-10-25,** pi in `pi-workspace`, on a throwaway tree outside it: `ls <target>` asked
     `Reaches outside …: <target> (and anything under it)`; after "Allow for this session", `read` of
     `<target>/sub/file.md` and `<target>/other.md` and `wc -l` on both through `bash` ran unasked; `ls <parent>`
     still asked, and No declined it; Yes on `ls <sibling>` ran that call only, and the next call under the sibling
     asked again; after `/reload`, `ls <target>` asked again.

5. **Done 2026-10-25: fewer false asks.** Found in the worktree slice 1 spike, where pi stopped three times on
   questions that protected nothing.
   - **`/tmp` is always allowed**, with `/private/tmp` (macOS's `/tmp` is a link to it, and the guard compares text),
     next to `os.tmpdir()`. Agents reach for `/tmp` by habit for scratch files, the model can't see the guard's
     rules, and a No tells it only "The user declined this call". With `mktemp -d /tmp/x.XXXXXX`, the guard sees the
     literal template, so even "Allow for this session" misses the random folder `mktemp` creates. `/tmp` is shared
     scratch space, not the user's projects or personal files, which the guard is for. Codex's default sandbox
     makes both `$TMPDIR` and `/tmp` writable.
   - **Patterns and markup aren't paths** (the [gap above](#what-it-isnt)): `grep -E '/Users/|/private/'` asked
     about `/Users/|/private`; with `$?` in the command, the raw-text fallback split it into `/Users` and `/private`;
     a heredoc regex with `</cwd>` asked about `/cwd`. Options: skip a piece that only looks like a path after
     splitting on `<`, `>`, or `|`; leave a heredoc's body out of the fallback; skip the pattern argument of
     `grep`, `rg`, and `sed`. Pick in the slice, the smallest that keeps every real path asked about, with a table
     test of both.
   - **Built:** `/tmp` and `/private/tmp` in `FolderRule`'s allowed places (`SCRATCH_DIRS`); in
     `src/core/util/paths.ts`, `isPathWord` turns down a word with no spaces holding `|`, `<`, or `>`, and the
     raw-text fallback keeps quoted strings with no spaces whole and drops tags. Not taken: skipping `grep`'s pattern
     argument by name, which means knowing every flag that takes a value (`-f FILE` would hide a real path).
   - **Tests:** `mktemp -d /tmp/…XXXXXX` and `/private/tmp/…` are allowed and `/tmpfoo` asks; the three spike
     commands and a heredoc of HTML name nothing; a heredoc script's `open('/etc/passwd')`, a `bash` heredoc's
     `~/.ssh/id`, a path after a stray apostrophe, a glued `</etc/hosts`, a quoted `--file=/etc/x`, and the real path
     next to a grep pattern are still named. Removing each of the four changes on its own failed its tests.
   - **Tried live 2026-10-25,** pi in `pi-workspace`, Build: `mktemp -d /tmp/s5.XXXXXX` with `rmdir`, the spike's
     `grep -E '/Users/|/private/' || test "$?" -eq 1`, and a heredoc regex with `</cwd>` all ran without a question;
     `head -1 /etc/shells` still asked. (`echo /Users/x | grep …` asks about `/Users/x`, which is a real path word.)


6. **Done 2026-10-25: no tree for home or above.** pi ran a heredoc with `split('/')`; the quoted `'/'` read as the
   path `/`, and "Allow for this session" on it would have allowed every path for the rest of the session. Now, for
   the home folder and every folder above it (`isInside(path, home)`), the question ends "(this path only)" and the
   allow is remembered as that exact path (`allowedPaths`); other places keep their tree (`allowedTrees`).
   - **Tests:** `~`, `/home`, and `/` ask "(this path only)"; after allowing `/`, `/` runs unasked and `/etc/hosts`
     still asks; the same under home and under a folder above home. Removing either half of the change fails them.
   - **Tried live:** pi in `pi-workspace`, Build: `test -d ~` asked "(this path only)"; after "Allow for this session"
     a second `test -d ~` ran unasked; `test -e ~/.zshrc` still asked, "(and anything under it)".
8. **Done 2026-10-28: no questions about nonexistent top-level folders or pi's own docs.**
   - **Found:** three false prompts came from regex and plan text whose slash-delimited tokens were interpreted as absolute paths (`/quiet`, `/search/i.test`, `/^export…`, `/gm`). Their first folders do not exist at `/`, so these tokens cannot reach files. Real paths such as `/etc/passwd`, `/etc/shells`, `/Users/x`, and `~/.ssh/id` must remain checked.
   - **Built:** read `/`'s entries once when the rule loads; filter bash command paths whose first folder is absent. The pure root check receives its entry list. Paths from tool `path` inputs are unchanged (including `/tmpfoo`). Reads may also reach pi's exported docs, examples, and README paths; writes there still ask.
   - **Tests:** table cases cover the three false command patterns, real path cases, root filtering, pi's docs/examples/README reads, and a docs write. The `/tmpfoo` test remains an `ls` path-input case because this slice only filters bash command paths.
   - **Tried live 2026-10-28,** fresh pi in a throwaway git repo, Build: `rg` over `notes.md` containing `/quiet`, the Node regex heredoc, and reading the installed extensions docs about `registerToolRenderer` all ran without a folder question. `head -n 1 /etc/shells` asked `Reaches outside …: /etc/shells (and anything under it)`; the dialog was answered Yes.
9. **Done 2026-10-29: four false alarms from the job-search-hub run** ([roadmap](../roadmap.md) row 32). Each was
   probed first with made-up paths: two were real gaps in the guard, one (pi's own logs) was already allowed, and one
   (`find ..`) was the guard behaving correctly while Build's prompt sent the model there. The guard's reach is
   unchanged; every path a real command can name is still asked about.

   | Case | Probe | Before | Now |
   |---|---|---|---|
   | pi's own logs | `read /tmp/pi-job-…`, `/tmp/pi-bash-…`, `<tmpdir>/pi-job-…` | allowed | allowed, now pinned; a mistyped `<tmpdir>-typo/…` and the folder above the temp folder still ask |
   | `find ..` | `bash "find .. -name AGENTS.md"` | asks the parent, correctly | same; Build's prompt no longer points at a file to fetch |
   | imports in written code | `cat > f <<'EOF'` with `from "../../libs/x"` | asks about a folder nothing reaches | no ask |
   | `cd` in a compound command | `cd frontend && cat ../shared/x.ts "$X"` (the parser gives up on `$X`) | names `<cwd>/../shared/x.ts` | names `<cwd>/frontend` and `<cwd>/shared/x.ts` |

   - **Built:** in `rawPaths` (`src/core/util/paths.ts`), the raw text is split into commands at line starts and
     unquoted `&&`, `||`, `;`, `|`, and `&`, so a `cd` at a command's start moves where later words resolve, as
     `segmentPaths` does; options are skipped, and `-`, a target holding `$` or a backtick, leaves the folder alone.
     Before the split, the body of a heredoc that is only written, not run, is blanked (its lines kept, so later
     text stays put): the writer is `cat`, `tee`, `printf`, or `echo` at the line's command position (after an
     optional `cd <word> &&`), with nothing chained after it and no process substitution on either side of the
     marker (`cat a && bash <<'EOF'`, `tee >(bash) <<'EOF'`, and `cat <<'EOF' > >(sh)` all keep their bodies checked);
     nothing but a redirect to a word holding no `|`, `;`, or `&` follows the delimiter on that line
     (`cat <<'EOF' >&1|sh` keeps its body checked); the delimiter (`<<-`, quoted, or escaped) has a closing line; the
     delimiter is quoted or the body holds no `$` or backtick; and nothing but whitespace follows the closing line,
     so a script written and run in the same call stays checked.
   - **Not taken:** widening the temp allowance (no temp root, no `/var/folders` tree), an `@/`- or `from`-specific
     import rule (`mv from "../x"` would slip through), and any allowance for `find ..`.
   - **Tests:** `test/core/util/paths.test.ts` — four `cd` rows and two boundaries, three written-heredoc rows naming
     nothing, five run/expanded/continued heredocs, two same-call script rows, and seven where another command, a
     process substitution, or a glued pipe takes the body, all still naming; `test/rule/folder.test.ts` — the
     `pi-job`/`pi-bash` logs allowed, the mistyped temp folder and its parent asking, the written heredoc allowed,
     `find ..` asking. Removing the `cd` walk, the blanking, the writer/no-pipe check, the last-command check, the
     chained-command check, the process-substitution guard, the redirect-target guard, or widening to the temp root
     each failed its rows.
   - **Tried live 2026-10-29,** fresh pi on gpt-6-luna at high in a throwaway git repo, Build:
     `cat > frontend/src/b.ts <<'EOF'` writing `import … "../../../libs/y"` ran unasked;
     `cd frontend && cat ../README.md; echo $?` ran unasked (the fallback resolved `../README.md` inside the
     project); `find ../.. -name AGENTS.md` asked the folder above the temp folder (in a temp repo `..` itself is
     the allowed temp folder), and No declined it; a background job's `pi-job-….log` read unasked, while `T-typo/…`
     on the same name asked and No declined it; and after `/new` + `/plan build`, asked about the project's coding
     conventions, the model read only the project's files and didn't look above it. A `mkdir -p frontend/src && cat
     > frontend/src/a.ts <<'EOF'` with `cat` after it still asked: the writer isn't at the command position and the
     call goes on (the gap above).

## Other harnesses

Checked 2026-10-25, for slice 4.

| Harness | How |
|---|---|
| Claude Code | Working directories: the launch folder plus `--add-dir`, `/add-dir`, or `additionalDirectories`, each a whole tree, readable without asking. Path rules are gitignore-style globs (`Read(//Users/alice/secrets/**)`). Approving a command that `cd`s outside saves a `Read` rule for that path. ([permissions](https://code.claude.com/docs/en/permissions)) |
| OpenCode | An `external_directory` permission (ask, allow, deny) with glob patterns where `*` crosses folders (`~/projects/personal/**`). "Always" approves the suggested patterns for the rest of the session. ([permissions](https://opencode.ai/docs/permissions/)) |
| Codex CLI | An OS sandbox, not path questions: reads anywhere the OS allows; writes only in the workspace and the `--add-dir` / `writable_roots` folders, each a whole tree. ([sandboxing](https://developers.openai.com/codex/concepts/sandboxing)) |

## Not taking

- **An OS sandbox** (`sandbox-exec`, containers). It would stop a program's own reads too, but it's per platform and
  heavy; pi runs on the user's machine on purpose.
- **Blocking instead of asking** (decided 2026-10-24): sometimes the user does want the agent to look elsewhere.
- **Following symlinks** to decide inside or outside. Text comparison matches how the rest of the guard works.
- **Allowing a file's folder when the file is allowed** (decided 2026-10-25), as OpenCode suggests. Reading `~/.zshrc`
  once would allow the whole home folder. Allowing a folder is the user's explicit choice, by allowing the folder.
- **Paths stuck to short flags** (`-I/usr/include`, `-o/tmp/x`, decided 2026-10-24). Splitting them means knowing
  which flags take a value, per command; `-la` and `-I/x` look alike otherwise. Rare in agent commands, which tend to
  use `--flag=value` or a separate word.

## Decided 2026-10-24

- Core, not a module: always on, with its rule in `src/rule/`, where later core rules go too.

- Ask, not block, with "Allow for this session".
- Both modes, Plan and Build.
- pi's opening `find .. -name AGENTS.md` prompts like any other outside call.

7. **Done 2026-10-26: forwarded Herdr text isn't a path here.** `herdr pane send-text` and `herdr agent prompt`
   pass their remaining words to another program, so this guard skips those words instead of asking about text such as
   `/plan build`. Its `<` targets are still checked. With an output redirect (`>`), `tokenize` gives up and the raw
   split checks the text like any word: a rare false prompt, kept rather than a second scanner. A plain shell
   receiving the text isn't covered by this guard; a pi in the other pane checks its own calls.

## Decided 2026-10-25

- "Allow for this session" on a path allows everything under it (slice 4), before the worktree tool.
- A file allowed covers only itself; its folder isn't widened.
- `/tmp` is always allowed, like `os.tmpdir()` (slice 5), reversing 2026-10-24's "`/tmp` asks".
- Patterns and markup that only look like paths stop asking (slice 5); the gap was found twice in one spike.
- Home and the folders above it, up to `/`, are allowed for the session as that path only (slice 6).
