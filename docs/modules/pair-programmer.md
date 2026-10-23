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

## Open questions

- How is the mode switched on and off: a command, a flag, or a session setting?
- What does the agent do by default in this mode: wait for questions, or comment on changes as they happen?
- Should it have edit tools at all, or only read and search tools plus suggestions?
- How does it remember how I like to work across sessions? Likely through global memories in the
  [memory](memory.md) module.
