# Context management

**Status:** building (A, B, and D done 2026-10-25; C planned; E planned after measuring)

## Why

Building worktree (2026-10-25), slices 1–3 ran in one pi session that reached 253k of a 272k window and compacted in
the middle of a build. As it filled, the code drifted from `docs/principles.md` (dense functions, defensive checks,
tests that bundled behaviors) and plans grew machinery that pi and git already had. A fresh session doing a cleanup
pass from a checklist cost $0.67 against the long session's $3.98, and read like the rest of MyPi. Across the day pi
made 627 tool calls in MyPi, 43 failed, and none used `lsp`; whole files of pi's compiled `dist/*.js` went straight
into the main context.

## What Claude Code does

From its docs ([context window](https://code.claude.com/docs/en/context-window),
[costs](https://code.claude.com/docs/en/costs)):

- After compacting, it re-injects CLAUDE.md and its memory, **the current plan file**, and invoked skills; re-reads
  **the five most recently edited files**; and reminds the model which background jobs and subagents still run.
- **Subagents** do research and checks in their own context; only a summary comes back. It starts small background
  agents freely for that.
- It **clears old tool results** from the context (counted as an "expected rebuild" in its cache stats).
- "Compact instructions" in CLAUDE.md, or `/compact <focus>`, steer the summary; `/autocompact <tokens>` sets when it
  compacts; `/clear` between tasks is the advice.
- Approving a plan doesn't clear the context by default (`showClearContextOnPlanAccept` is opt-in): it leans on
  putting the plan back after compaction instead.

pi already keeps MyPi's prompt sections and `AGENTS.md` through compaction, since they're system prompt. What it
doesn't keep: the plan being implemented, `principles.md`, and recently edited files. It compacts late by default
(`compaction.reserveTokens` 16k, so at about 256k of 272k), and MyPi has no subagents yet.

## Pieces

| | What | Where | Status |
|---|---|---|---|
| A | Compact earlier | `compaction.reserveTokens: 80000` in `~/.pi/agent/settings.json`: about 192k of 272k for gpt-6.1-sol, 120k for a 200k model | **Done 2026-10-25** (this machine's setting, not MyPi code) |
| B | The plan stays in view | plan-build | **Done 2026-10-25** |
| C | Steer the summary | core, `session_before_compact` | Planned |
| D | Re-check the principles before "done" | plan-build's Build section | **Done 2026-10-25** |
| E | Clear old tool results | core, pi's `context` event | Planned, after measuring |

### B: the plan stays in view

When a Build session implements a plan (`/plan implement`, or Implement from the dialog), plan-build's Build section
names the plan file: "Implementing `<path>`; re-read it when unsure what's left." Sections are re-sent on every run,
so the path survives compaction, which is Claude Code's plan re-injection without re-sending the whole plan. The
path comes from the seed message or the dialog's `submittedPlan`, saved in the module's state so `/reload` keeps it.
Pairs with [plan-build slice 9](../modules/plan-build.md#slices) (Clear context by default): fresh sessions for big
plans, and the plan stays findable in long ones.

### C: steer the summary

A `session_before_compact` handler (pi's `docs/compaction.md`) adds instructions to the summary: keep every decision
the user made and why, the plan file's path, files changed and still to change, and open questions; drop file
contents and tool output, which can be re-read. Core, in `MyPi`, since it's one fixed text; plan-build's plan path
can join it through the event bus if B's section turns out not to be enough.

### D: re-check the principles before "done"

One line in plan-build's Build section: before saying a slice is done, re-read "Before a slice is done" in
`docs/principles.md` (or the project's own equivalent named in `AGENTS.md`) and check the diff against it. Prompt
only. The done check already runs the tests; this covers what tests can't (names, size, defensive code).

### E: clear old tool results

pi's `context` event hands extensions the messages before each model call, and a handler may return them changed.
A handler would replace a large tool result (over about 2k tokens) from more than a few turns back with a stub that
names the tool and its input ("`read src/a.ts`: 340 lines, cleared; read again if needed"). The transcript keeps the
original. Most of the 253k came from such results: whole files and long command output, read once and never needed
again.

Measure first ([analytics](../modules/analytics.md)): how much of each request is old tool output, and how often
the model re-reads what was cleared. Watch the prompt cache: rewriting old messages changes the prefix, so clear in
batches at a threshold, not on every call.

### Subagents

[Subagents](../modules/subagents.md) are now a foundational module (decided 2026-10-25), partly for this: research
and checks run in a subagent's own context and only a summary comes back, the way Claude Code starts small
background agents for them. That keeps big reads out of the main session, which B–E only trim after the fact.

## Not taking

- Clearing the context with no choice: small plans gain nothing (plan-build slice 9).
- Re-reading the recently edited files after every compaction, as Claude Code does: pi's own summary already tracks
  file operations, and re-reading costs tokens each time; revisit if B–C aren't enough.
