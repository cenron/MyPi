# worktree

**Status:** done (slices 1–4 done 2026-10-25, on pi 1.2.0)

## Goal

Let the agent work in a git worktree when it's useful: a separate checkout on its own branch, so its edits don't touch
the main checkout. Optional, never required: most sessions work in place.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | `EnterWorktree` creates a worktree under `.claude/worktrees/<name>/` on a new branch `worktree-<name>` and moves the session into it; `ExitWorktree` moves back. `--worktree <name>` starts a session in one. The base is the default branch (`worktree.baseRef: "fresh"`) or the current `HEAD` (`"head"`). `.worktreeinclude` (gitignore syntax) lists ignored files such as `.env` to copy in. On exit, a clean worktree is removed with its branch; one with changes asks keep or remove. While in a worktree, edits and commands aimed at the main checkout are blocked. |
| OpenCode | `worktree_create { name }`, `worktree_list`, and `worktree_remove { directory }` tools, under its own namespace. Worktrees live in a global data dir per project, set by `worktree.directory`. Moving the session into one is a separate `session_move` call. Removing one needs the same approval as editing files. |
| Codex CLI | No worktree tool. |

## Moving the session in pi

Pi 1.2.0 has no in-place cwd setter: `ctx.cwd` is read-only, and tools resolve paths against the cwd they were built
with. It does have **native session replacement**, which recreates cwd-bound services. Route 3 is verified and is
what enter/exit should use:

1. **Override the built-in tools.** Rejected for this design. Tool factories and same-name replacement exist, but
   rebinding tools alone leaves the prompt, resource discovery, and MyPi services to patch separately. Native
   replacement already moves them together; no worktree-specific tool overrides or cwd-prompt spoofing are needed.
2. **Shared service manages worktrees.** Subagents call `Session.worktrees` to create, list, and remove without
   moving the main session. This is slice 2, not an alternative enter/exit implementation or a model-facing tool.
3. **Switch to a session rooted in the worktree.** Prepare a target session file, then call command-context
   `ctx.switchSession(path, { withSession })`. Inspect and use the replacement only through the fresh callback
   context. Save the original session path as plain data outside the replaced runtime; exit switches back to it.

### Installed API/source findings

Both the installed CLI and pinned development dependency were 1.2.0. References below are relative to the installed
`@earendil-works/pi-coding-agent` package:

- `dist/core/extensions/types.d.ts`: switching is **command-only**, not available from a tool or lifecycle handler.
  Command-context `switchSession` has `withSession`, but no `setup` or `cwdOverride`. Navigation is implemented as
  commands, never as a replacement call from a tool.
- `dist/core/agent-session-runtime.js`: `switchSession` opens the target file, reads its header cwd, shuts down the
  old runtime, creates the replacement, and supplies a fresh context to `withSession`. `newSession` supports `setup`
  and `withSession` but retains the current cwd; it is not a cwd-changing API.
- `dist/core/agent-session-services.js` and `dist/core/agent-session.js`: replacement rebuilds cwd-bound settings,
  resource discovery, tools, and extension runtime. MyPi's `onSessionStart` constructs a new `Session` and modules.
- `dist/core/session-manager.js`: `SessionManager.forkFrom(sourcePath, targetCwd, sessionDir?)` creates a distinct ID,
  target-cwd header, and original `parentSession` link, copying all non-header entries without manual JSONL editing.
  On reopen, the last persisted entry determines the leaf. `branch()` alone changes only the in-memory leaf;
  `navigateTree` without a summary or label can leave that selection unpersisted.
- `dist/modes/interactive/interactive-mode.js` supplies a target-cwd project-trust context when switching.
  `dist/core/project-trust.js` and `dist/core/trust-manager.js` resolve and store trust decisions.

### Live spike results (2026-10-25)

An isolated throwaway Git repository, linked worktree, agent configuration, session storage, and explicit temporary
extension were used. The extension loaded MyPi with the production lifecycle wiring and a deterministic local test
provider that issued real bash/read calls through pi; no remote model or credentials were needed. The user's active
conversation was not switched. All temporary fixture data was removed afterward.

| Check | Observed result |
|---|---|
| Services move | Every replacement constructed a new MyPi Session with the target `ctx.cwd`; all four modules loaded. In the worktree, MyPi bash `pwd`, native `read` of relative `fixture.txt`, and the actual model-facing prompt's `<cwd>` all agreed on the worktree. The fixture contents distinguished it from the source checkout. |
| Fresh versus forked history | A fresh target session, materialized with its own fixture user message, contained no source conversation. A deliberate custom handoff sent through fresh `withSession` added only that summary, not full source history. |
| Active branch, raw fork | The source had distinguishable A/B branches, with B last persisted. After navigating to older A without summarizing, raw `forkFrom` reopened B, not the live selection A. Copying entries alone is insufficient. |
| Active branch, anchored fork | Appending a custom entry on selected A through `pi.appendEntry` before `forkFrom` persisted that branch choice. The target retained the recognizable source conversation and A in both its branch projection and actual model context. B remained in the stored tree but outside model context. The target had a distinct ID, target cwd, and original parent-session link. |
| Return and re-entry | Switching to the saved original file restored its ID, source cwd, and conversation, including anchored A. Worktree-only messages and tool results did not merge back. Reopening the same worktree session restored its own ID and worktree-only history. |
| Project trust | Tracked `.pi/settings.json` forced a trust decision in each checkout. First entry to the worktree displayed its path. Choosing **Trust** saved that path in the isolated trust store; later entry to another session at that cwd and repeat entry to the same session did not prompt again. Return to the trusted source did not prompt either. |

**Verified history-transfer route:** while idle, persist the outgoing selected branch with a custom entry before
forking or switching away, then use `SessionManager.forkFrom` and command-context `switchSession`. The anchor adds
non-model state, not a summary or copied conversation message. This also lets reopening the original file recover
its selected branch. Do not assume an unpersisted tree selection will survive either a fork or a return.

**Seeding alternative:** prepare target entries through `SessionManager` before switching, or deliberately send a
handoff through the fresh `withSession` context. The latter was exercised with a custom message without triggering
a model turn. A handoff is not full-history continuity. Source inspection shows that `SessionManager.create` alone
does not materialize a session file until it has a user or assistant message; the fresh-session test seeded a user
message for that reason. `newSession.setup` does not move cwd.

**Scope:** the cwd replacement and conversation checks above are live results. Folder-guard, LSP, memory, and
done-check use the new session cwd in source, but their individual behavior was not exercised; that belongs to
slice 3. Trust without protected project resources, session-only trust, cancellation, and replacement failures were
not tested. The observed saved-trust behavior is not a worktree re-entry policy.

### Ignored files are not session continuity

A linked worktree checks out tracked files, not ignored or untracked files from the original checkout. The fixture
confirmed that ignored source-only memories and plans did not appear in the target, while tracked done-check
configuration did. In MyPi itself, `.pi/memories/` and `.pi/plans/` are ignored, and `.pi/done-check.json` is tracked.
Target-rooted memory and plan paths therefore do **not** preserve existing local memories or saved plan files.
Forked conversation or module state can still refer to source-only files. The slice 4 decision below supersedes
copying for memories/plans: sessions share the main checkout's folders directly. This spike implemented neither
sharing nor ignored-file copying; an explicit include list for other ignored files is deferred until needed.

## How it works

### Commands

`/worktree` is a built-in command (`src/command/worktree/`), not a module and not a model tool: pi switches sessions
only from a command (slice 1). Words after what a subcommand needs are ignored, as in `/plan` and `/modules`.

| Command | What it does |
|---|---|
| `/worktree` or `/worktree list` | Lists the repository's checkouts: main, MyPi's (`mypi: <name>`), other, and which one this session is in. |
| `/worktree enter <name>` | Creates the worktree if it's new, then moves this conversation into it. |
| `/worktree exit [keep\|remove]` | Returns to the conversation that entered, then keeps or removes the checkout. With no word it asks Keep, Remove, or Cancel; without a UI it keeps. |
| `/worktree remove <name>` | Removes a worktree this session isn't in. |

- **Enter:** waits for the agent to be idle and refuses while a job runs (a session switch would stop it). From
  inside a worktree it refuses, so worktrees don't nest. A saved custom entry first makes the selected conversation
  branch the session file's last one. A new worktree gets a fork of the conversation (`SessionManager.forkFrom`);
  pi records the entering session as its `parentSession`. An existing one resumes its latest session, and a
  `mypi-worktree-origin` entry saved in it names the conversation that just entered. A worktree created under a
  removed one's name always forks: old transcripts at the same path aren't adopted.
- **Exit:** finds where to return: the latest origin entry on the current branch, else the first session up the
  `parentSession` chain whose cwd is outside the worktree. That walks through `/plan implement` sessions, which set
  a parent. A bare `/new` has no parent, so exit says so and suggests `/resume`. It switches back first, then, for
  Remove, removes through a fresh `Worktrees` rooted in the origin; a refusal keeps the checkout and says why.
- Both report only through the new session's context: after `switchSession`, the old `ctx` and `Session` are stale.

### The service

`Session.worktrees` (`src/core/worktree/`) is core: the commands use it, and subagents will. It does nothing until
called and never moves a session. Git does the checking: an existing branch or path, or a locked worktree, fails with
git's own message, and nothing runs with `--force`.

- `project()`: the main checkout and git's common folder, or undefined outside git. `MyPi.onSessionStart` resolves
  it once and passes it into `Session`; when git fails, MyPi warns and starts without a project, so the folder guard
  still loads.
- `create(name)`: `<main>/.pi/worktrees/<name>` on a new branch `mypi/worktree/<name>`, from the calling checkout's
  committed HEAD. `.pi/worktrees/.gitignore` (`keepOutOfGit`) keeps git, Biome, and `rg` off the copies.
- `list()`: every checkout; `managedName` only for MyPi's own, at its exact path *and* on its branch.
- `inspect(name)`: a managed worktree and its blockers.
- `remove(name)`: refuses the worktree the caller is in, and any blocker: changed or untracked files, and new files
  in `.pi/memories/` or `.pi/plans/` even though they're ignored (a patch from `git diff` can't carry them; the two
  ignore markers don't count). Other ignored files, such as `node_modules`, go with the checkout. Then
  `git branch -d`, which keeps an unmerged branch and says why.
- `discard(name)`: for a managed worktree only, refuses the caller's current worktree and new or changed files in
  `.pi/memories/` or `.pi/plans/`; after its work has been saved elsewhere, removes the checkout with
  `git worktree remove --force` and deletes its branch with `git branch -D`.

### Shared state

- **Memories and plans** belong to the project, not a branch: the memory module and plan-build use
  `<main>/.pi/memories/` and `<main>/.pi/plans/` (the cwd's own folders outside git), and declare exactly those with
  `setWritable`. Nothing is copied. The dialog hands `/plan implement` the plan's path as a `file://` URL, so spaces
  in the main checkout's path survive.
- **Done-check approval** is keyed by the git common folder, so a repository's worktrees share it; config is read
  and commands run in the active checkout. Old folder approvals ask once more.
- **Writer dependencies** are links, not copies: a subagent writer's worktree gets every ignored `node_modules` from
  the main checkout, at the root and nested, as a symlink. Staging excludes them, so the patch never carries them;
  discarding the worktree removes the links without touching the main checkout's dependencies. A tool that writes a
  cache under a linked `node_modules` (for example `node_modules/.vite`) writes into the main checkout; accepted for
  now. `/worktree enter` does not link dependencies.
- Not done: copying other ignored files (`.env`) into a worktree, with an explicit include list. Writers link only
  `node_modules`; other ignored files are still not shared. Build it when someone needs it.

### Tried live (2026-10-25)

pi on gpt-6.1-sol in a throwaway repo: `/worktree enter live` moved the session into `.pi/worktrees/live`; asked to
save a project memory there, the agent wrote `<main>/.pi/memories/live-test.md` with no question, and the worktree
had no `.pi` of its own; a plan submitted in Plan landed in `<main>/.pi/plans/`, and "Clear context and implement"
opened it through its `file://` path in a Build session still in the worktree; `/worktree exit remove` walked back
through that session to the main checkout, removed the worktree, and deleted its branch, while the memory and plan
stayed. Separately, exit with Remove on a worktree with an untracked file returned and kept it: "Worktree dirty has
work that would be lost; commit or move it first: new.txt".

## Slices

1. **Done 2026-10-25:** proved pi's own session replacement moves everything cwd-bound (above).
2. **Done 2026-10-25:** the shared `Session.worktrees` service, for subagents without moving the main session.
3. **Done 2026-10-25:** `/worktree` enter, exit, list, and remove; done-check approval per repository.
4. **Done 2026-10-25:** shared memories and plans; exit's Keep, Remove, or Cancel.
5. **Review, 2026-10-25:** cut what git and pi already check (existing branch or path, locked worktrees, merged
   branches, a session's cwd), the symlink and bare-repository checks, abort-signal plumbing nobody passed, an unused
   `checkout` field, and argument-count checks; tests went from 993 to 934 for the whole suite, and the worktree files
   from about 1,400 lines of code and tests to about 820. Each kept rule was broken on purpose to see its test fail.

## Subagent integration

The subagents writer helper is implemented and tested directly; wiring it into runs remains checkpoint 4. Once
wired, [Subagents](../modules/subagents.md) will use `Worktrees.discard` after saving a writer's patch and handoff. It is limited
to managed checkouts, refuses new or changed `.pi/memories/` and `.pi/plans/` files, then removes the worktree
forcibly and deletes its branch. The subagents module calls the service without moving the main session; each writer's
temporary worktree and branch are removed after its patch and handoff are captured.

## References

- pi 1.2.0: installed API/source paths above; `docs/extensions.md` (command-only replacement and fresh contexts),
  `docs/sdk.md`, `docs/session-format.md`, `docs/security.md` (project trust), `examples/extensions/handoff.ts`
- Claude Code: [worktrees](https://code.claude.com/docs/en/worktrees)
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/opencode.ts`, `packages/core/src/worktree/`
- git: [git-worktree](https://git-scm.com/docs/git-worktree)
