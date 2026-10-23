# worktree

**Status:** idea

## Goal

Let the agent work in a git worktree when it's useful: a separate checkout on its own branch, so its edits don't touch
the main checkout. Optional, never required: most sessions work in place.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | `EnterWorktree` creates a worktree under `.claude/worktrees/<name>/` on a new branch `worktree-<name>` and moves the session into it; `ExitWorktree` moves back. `--worktree <name>` starts a session in one. The base is the default branch (`worktree.baseRef: "fresh"`) or the current `HEAD` (`"head"`). `.worktreeinclude` (gitignore syntax) lists ignored files such as `.env` to copy in. On exit, a clean worktree is removed with its branch; one with changes asks keep or remove. While in a worktree, edits and commands aimed at the main checkout are blocked. |
| OpenCode | `worktree_create { name }`, `worktree_list`, and `worktree_remove { directory }` tools, under its own namespace. Worktrees live in a global data dir per project, set by `worktree.directory`. Moving the session into one is a separate `session_move` call. Removing one needs the same approval as editing files. |
| Codex CLI | No worktree tool. |

## The pi problem

Pi 1.2.0 has no API to change a session's working directory: `ctx.cwd` is read-only, and pi's built-in tools resolve
paths against the cwd they were built with. Routes to check:

1. **Override the built-in tools.** pi exports `createReadToolDefinition(cwd)`, `createBashToolDefinition(cwd)`, and
   the rest. Registering a tool with a built-in's name replaces it (`examples/extensions/tool-override.ts`). Entering
   a worktree re-registers them with the worktree's path, and exiting re-registers them with the original. The
   system prompt's `cwd` section would need patching through `PromptManager`, and the tool guard's path checks would
   need the worktree's path.
2. **Tools only manage worktrees**, like OpenCode without `session_move`: create, list, remove, and the agent uses the
   worktree's absolute path. Simple, but easy for the model to slip back into the main checkout.
3. **A new pi session in the worktree**: `SessionManager.create(worktreePath)` and switch to it. Unverified whether
   pi rebuilds its tools with that cwd.

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

1. Verify which of the three routes works in pi 1.2.0.
2. Create, list, and remove.
3. Enter and exit, using the route from slice 1.
4. Copying ignored files, and the keep-or-remove check on exit.

## Open questions

- Which route for moving the session into a worktree?
- Tool shape: enter/exit, create/list/remove, or both?
- Where do worktrees live?
- Base branch: the default branch, or the current `HEAD`?
- [Subagents](../modules/subagents.md) depend on this (decided 2026-10-23): each sub-agent writer gets its own
  worktree so writers can run in parallel. Design the create and remove steps so the subagents module can call them
  without moving the main session. A writer's work comes back as a patch (decided 2026-10-23, see its doc), so
  the worktree and branch are temporary: created for the run, removed once the patch is captured.

## References

- pi: `createReadToolDefinition` and the other factories (exported from the package), `examples/extensions/tool-override.ts`,
  `SessionManager.create` in `dist/core/session-manager.d.ts`, `docs/sdk.md` (what `cwd` controls)
- Claude Code: [worktrees](https://code.claude.com/docs/en/worktrees)
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/opencode.ts`, `packages/core/src/worktree/`
- git: [git-worktree](https://git-scm.com/docs/git-worktree)
