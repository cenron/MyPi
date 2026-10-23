# Done check

**Status:** idea (recorded 2026-10-22)

## Goal

When the agent says it's done, check the work before I look at it: the typecheck, the tests near the change, and new
diagnostics once the [LSP](lsp.md) module exists. Report only what got worse, and send the agent back to fix it or say
why it's fine. A module, so it can be turned off.

## Where the idea comes from

- **ripwire** ([inspiration](../inspiration/ripwire.md)): `--quality-delta` (only what got worse against a baseline),
  `--edit-check`, and `--test-gate`, run at the "I think I'm done" moment. Its field report credits that gate with a
  dozen real fixes across about 15 agents, through a "fix it or justify it in writing" rule.
- **Serena** ([inspiration](../inspiration/serena.md)): diagnostics diffed before and after an edit, but switched off
  per edit, since one edit often breaks what the next one fixes. Checking once, at the end, avoids that noise.

## What pi offers

- **`agent_settled`:** fires once pi won't continue on its own. plan-build's "Implement this plan?" dialog uses it.
- **`tool_result`:** carries each call's input, so the module can collect the files a turn wrote or edited.
- **`sendMessage` with `followUp` and `triggerTurn`:** how background-job exit notices (`mypi-job`) send the agent
  back to work.
- **Running commands:** pi's `createLocalBashOperations`, which MyPi's `JobManager` already uses.

## Behavior

- Runs only in Build, and only when the turn changed files.
- Runs the project's checks, such as the typecheck and the tests for the changed files (where they're configured is
  open).
- Reports only new problems: errors in the files the turn changed, or the difference from a baseline taken when the
  turn started (open).
- Sends one follow-up message with the failures, asking the agent to fix them or explain why they're fine.
- Can't loop: at most a few rounds per prompt, and it stops when the same failures come back.
- Shows `checking…` in the footer while it runs.
- Later, [analytics](analytics.md) counts how often it caught something, to show whether it pays.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/done-check/` | Load type open. |
| Changed files | `tool_result` on `write`, `edit`, and `apply_patch`, through `session.pi.on` in `init()` | Files changed by `bash` aren't seen this way; `git status` before and after is the fallback (open). |
| Trigger | `agent_settled`, in Build only | Plan mode makes no edits. |
| Checks | Commands run through pi's bash operations, or `session.jobs` | A long check shouldn't block the TUI. |
| Report | `sendMessage(…, { deliverAs: "followUp", triggerTurn: true })` | Like `mypi-job` notices. |
| Diagnostics | From the LSP module when it's loaded | Optional; the module works without it. |

## Slices

1. Collect the files each turn changed.
2. On `agent_settled` in Build, run the configured commands and send failures back.
3. The loop guard.
4. Only what got worse: a baseline, or errors in changed files only.
5. LSP diagnostics, once the LSP module exists.

## Open questions

- Where are the commands set: a project file (`.pi/done-check.json`?), read from `package.json` scripts, or listed in
  `AGENTS.md`?
- Baseline: run the checks when the turn starts (slow), or report errors in changed files only?
- Files changed through `bash`: compare `git status` before and after?
- Its own module, or part of the LSP module? (Its own works without LSP.)
- How many rounds before it gives up?
- Should a build started from "Implement this plan?" always end with it?

## References

- ripwire: README § "Better Code", the field report, `--quality-delta` in `docs/COMMANDS.md`
- Serena: `EditingToolWithDiagnostics` in `src/serena/tools/tools_base.py`
- MyPi: background-process exit notices in [background-process](../tools/background-process.md)
