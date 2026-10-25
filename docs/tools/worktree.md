# worktree

**Status:** building (slice 1 done 2026-10-25, on pi 1.2.0; no production worktree tools yet)

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
2. **Tools only manage worktrees.** Still useful for subagents: create, list, and remove without moving the main
   session. This is slice 2, not an alternative enter/exit implementation.
3. **Switch to a session rooted in the worktree.** Prepare a target session file, then call command-context
   `ctx.switchSession(path, { withSession })`. Inspect and use the replacement only through the fresh callback
   context. Save the original session path as plain data outside the replaced runtime; exit switches back to it.

### Installed API/source findings

Both the installed CLI and pinned development dependency were 1.2.0. References below are relative to the installed
`@earendil-works/pi-coding-agent` package:

- `dist/core/extensions/types.d.ts`: switching is **command-only**, not available from a tool or lifecycle handler.
  Command-context `switchSession` has `withSession`, but no `setup` or `cwdOverride`. Slice 3 must account for this
  tool/command boundary rather than calling replacement directly from a tool.
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
Forked conversation or module state can still refer to source-only files. Slice 4 must decide what to copy, analogous
to `.worktreeinclude`; this spike implemented no ignored-file copying.

## Behavior

- Create a worktree on a new branch, and optionally move the session into it.
- Leave it: back to the main checkout, keeping or removing the worktree.
- List and remove worktrees.
- Copy listed ignored files (`.env` and similar) into a new worktree.
- Never remove a worktree with changes without asking.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tools | A folder, `src/tool/worktree/`, listed in `createTools` | `worktree_enter` / `worktree_exit` (Claude Code) or `worktree_create` / `worktree_list` / `worktree_remove` (OpenCode). Open question. |
| Git | `git worktree add -b <branch> <path> <base>`, `git worktree list --porcelain`, `git worktree remove` | Run with `execFile`, never through a shell. |
| Location | `.pi/worktrees/<name>/` in the repo, git-ignored like `.pi/plans/` | Or a global dir per project, like OpenCode. |
| Session state | Which worktree the session is in, saved with `Session.save` | Restored on `/reload` and resume. |
| Plan mode | Creating, entering, and removing are not read-only | Ask or block in Plan, like other writes. |

## Slices

1. **Done 2026-10-25:** verified native command-context session replacement in pi 1.2.0: cwd-bound services move,
   anchored forks preserve the selected conversation branch, and return restores the original session without merging.
2. Create, list, and remove, callable by subagents without moving the main session.
3. Production enter/exit using native replacement, including the command-only boundary and module-level exercises.
4. Copying ignored files (including project memories/plans), and the keep-or-remove check on exit.

## Open questions

- Re-entering an existing worktree should reopen its own session rather than fork the original conversation again;
  how should that session be associated with the worktree?
- Tool shape: enter/exit, create/list/remove, or both?
- Where do worktrees live?
- Base branch: the default branch, or the current `HEAD`?
- [Subagents](../modules/subagents.md) depend on this (decided 2026-10-23): each sub-agent writer gets its own
  worktree so writers can run in parallel. Design the create and remove steps so the subagents module can call them
  without moving the main session. A writer's work comes back as a patch (decided 2026-10-23, see its doc), so
  the worktree and branch are temporary: created for the run, removed once the patch is captured.

## References

- pi 1.2.0: installed API/source paths above; `docs/extensions.md` (command-only replacement and fresh contexts),
  `docs/sdk.md`, `docs/session-format.md`, `docs/security.md` (project trust), `examples/extensions/handoff.ts`
- Claude Code: [worktrees](https://code.claude.com/docs/en/worktrees)
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/opencode.ts`, `packages/core/src/worktree/`
- git: [git-worktree](https://git-scm.com/docs/git-worktree)
