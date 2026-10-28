# Pair programmer

**Status:** idea

## Goal

A pi mode where I write the code and the agent works as my pair: it explains, navigates the codebase, reviews, and answers questions instead of taking over the keyboard.

## Observations so far

Notes from pairing while building MyPi, to feed the design:

- Plan first. The agent proposes, I approve, and only then does anything change.
- It verifies against official docs and current versions instead of answering from memory.
- It reuses patterns from my earlier projects rather than inventing new conventions.
- It asks when a choice is mine, and offers a recommendation with the options.
- Living docs (architecture, principles, module ideas) carry the shared context between sessions.

## Inspiration

[pairing-buddy](../inspiration/pairing-buddy.md) (read 2026-10-27) is the closest design so far, built on the same pi
packages and at home in herdr. The ideas worth designing here: roles as modes with each role's tools enforced by a
rule (Navigator: no edits; Scout: read-only commands and approved checks; Driver: edits only on hand-over); speaking
rarely, scored first and held until the user pauses; triggers read from the user's herdr panes (a failed command in
another pane, the same error twice, editing a file the red test doesn't name); a written, tested tone; the session's
goal from the branch and a note at its end. What doesn't carry over is its Neovim plugin: MyPi can't draw under the
user's cursor.

## Open questions

- How is the mode switched on and off: a command, a flag, or a session setting?
- What does the agent do by default in this mode: wait for questions, or comment on changes as they happen?
- Should it have edit tools at all, or only read and search tools plus suggestions?
- How does it remember how I like to work across sessions? Likely through global memories in the
  [memory](memory.md) module.
