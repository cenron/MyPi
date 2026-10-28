# pairing-buddy

**Read:** 2026-10-27, commit `cd2dc8d` (version 0.10), from
[github.com/makefunstuff/pairing-buddy](https://github.com/makefunstuff/pairing-buddy) and its
[docs site](https://makefunstuff.github.io/pairing-buddy/). **License:** MIT.
**Feeds:** [pair-programmer](../modules/pair-programmer.md), [notifications](../modules/notifications.md),
[done-check](../modules/done-check.md), [memory](../modules/memory.md), [analytics](../modules/analytics.md).

A pair programmer for Neovim "that knows when to speak": a daemon plus a Neovim plugin that watches you code, says one
short line under your cursor when something is worth it, runs the tests you'd skip, and takes the keyboard only when
you hand it over. It never writes your files: its edits land unsaved in your buffer as one undo step. It's built on
the same pi packages MyPi runs on (`@earendil-works/pi-ai` and `pi-durable` 1.4.0), and herdr is "the best home" for
it: it reads your herdr panes and runs its commands in a pane of its own.

## What it does

- **Two models.** A small, fast **Watcher** scores each moment 0 to 10 with one number (about a second, no thinking);
  only a moment over the bar reaches the **Partner**, which writes the words and uses its role's tools. One model can
  play both. An optional classifier (pi's `models.classify()` kind, such as TypeSafe's Jev) can sort moments first.
- **Three roles, one at a time, tools enforced in code:** **Navigator** (the default) watches, answers, points at
  lines and suggests changes, with no tool to run or edit; **Scout** also searches and runs commands in its own
  visible pane (read-only commands, tests and builds run; writes ask; commits, pushes, network and `sudo` are refused;
  at most four commands per question); **Driver** edits only when you hand it over, a line at a time while you watch,
  up to five edits as one undo step, checks the result with the tests before handing back, and any key takes the
  wheel back.
- **A speak gate.** Cheap rules drop plain noise, the Watcher scores, a budget limits how often it talks ("talk
  levels"). It never speaks while you type; a remark that can wait is held for your next break (a save, a run that
  ended, a quiet stretch).
- **Triggers** for unasked remarks: a command that failed in a pane you aren't looking at, the same error twice, a new
  diagnostic in code you just wrote after you moved on, no progress after a failure, editing a file unrelated to the
  session goal, editing a source file the red test doesn't name ("the wrong turn"), a regression in the tests it ran
  on save, a crash, the same numbers after a change, a search trail that found nothing.
- **A tone spec in the prompt, and tested:** a senior colleague in the second chair, not an assistant; lead with the
  fact, then the reason; name `file:line`; no praise, apologies, filler hedges, emoji or exclamation marks; plain
  sentences; don't narrate the tools.
- **Sessions without ceremony:** the goal comes from the herdr board's task for the branch, else the branch name, else
  one question. A session ends by itself and writes a note on where the next one picks up; your verdicts on its
  remarks teach it what's worth saying.
- **Tests on save:** a per-project command from the config (the model never chooses or starts one), run in its own
  pane, with only the affected tests when it can tell.
- **Your other agents in one line:** when another coding agent needs you, waits for approval, failed, or is done, it
  says so once, at your next pause, with the key that jumps to that agent's herdr pane.
- **The exploration loop:** build, run, change one thing, run again. Each run is numbered and read against the one
  before, so it can say "the same numbers after your change" (the change did nothing, and why) or "this number moved"
  at the end of a hunt; `:Pair runs` is the notebook of them.
- **A hand-over checked against a stated bound** when there's no test: "keep avg probe under 2" is checked in code
  against the run's numbers, `✓` or `✗` with every number shown.
- Also: margin marks on Markdown notes (`?` an unanswered question, `≠` a contradiction, `→` a claim the code decides),
  a blank-page flow (`:Pair new`: three questions, then a first slice as a suggestion), voice, and `pair doctor`.

## Ideas for MyPi

For the [pair-programmer](../modules/pair-programmer.md) mode first; each would be designed there, not here.

1. **Roles as modes, with tools per role enforced by a rule.** MyPi already has the pieces: plan-build's modes, the
   tool guard, and Plan's read-only rule. Navigator is close to Plan with no edits at all; Scout to Plan plus the
   project's approved checks (what read-only subagents may run); Driver to Build for one handed-over change. The
   guard enforces the role, the prompt only explains it.
2. **Speak rarely, and only at a break.** The opposite of an agent that answers everything at length. A cheap scoring
   step (pi's classifier models in `codemode`, or a small model) before the main model, a budget, and holding a
   remark until the user pauses. In pi the "pause" is easier to see than in an editor: the end of a run, or a command
   that finished in a herdr pane.
3. **Triggers from the user's terminals through herdr.** A failed command in another pane, the same error twice, the
   tests red while the user edits a file the failure doesn't name. MyPi drives herdr already for live checks; reading
   the user's panes is the same seam in the other direction.
4. **A tone spec, written down and tested.** It matches the user's own style log (short, fact first, `file:line`, no
   filler), and MyPi's prompt sections are where it would live.
5. **The session goal from the branch** and a **note at the end** of where the next session picks up: a small fit for
   the [memory](../modules/memory.md) module.
6. **Remarks with verdicts:** counting which remarks the user kept or waved away is
   [analytics](../modules/analytics.md)' "measure before steering" applied to the partner itself.
7. **"Your other agents, in one line":** the [notifications](../modules/notifications.md) idea, done the quiet way: one
   line at the next pause, not a pop-up, with a way to jump to the pane.
8. **Runs read against each other, and bounds checked in code:** for a performance or tuning session, numbering runs
   and saying when a change moved nothing is a partner's job that no MyPi tool does yet.
9. **The hand-over is checked before it's handed back:** like MyPi's [done check](../modules/done-check.md), but on
   the user's unsaved work, in a scratch copy.

## What doesn't fit

- **The Neovim plugin and the daemon.** MyPi lives in pi's own TUI, beside whatever editor the user runs; it can't put
  lines under the user's cursor. Its in-place suggestions (struck-through line, one key to accept) have no pi
  equivalent; the nearest is a patch to apply, as subagent writers do.
- **Editor events** (keystrokes, cursor, pickers, LSP diagnostics from the editor). Without an editor plugin, MyPi sees
  files on disk, git, and herdr panes, not typing.
- **Voice, the margin marks on notes, the pixel-art site:** out of scope for a coding harness.
