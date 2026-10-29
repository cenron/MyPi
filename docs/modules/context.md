# Context

**Status:** building (A–E done 2026-10-25)

**Load type:** `ON_LOAD`. The `context` module (`src/module/context/`) holds C (`compaction.ts`), E
(`tool-results.ts`), and F (`mid-run.ts`); turning it off in `/modules` turns them all off. A is a pi setting, and B and D live in
[plan-build](plan-build.md), since they're about Plan and Build. Decided 2026-10-25: a module, not core, since only
it uses this code.

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
| C | Steer the summary | this module, `compaction.ts` (`session_before_compact`) | **Done 2026-10-25** |
| D | Re-check the principles before "done" | plan-build's Build section | **Done 2026-10-25** |
| E | Clear old tool results | this module, `tool-results.ts` (pi's `context` event) | **Done 2026-10-25** |

### B: the plan stays in view

When a Build session implements a plan (`/plan implement`, or Implement from the dialog), plan-build's Build section
names the plan file: "Implementing `<path>`; re-read it when unsure what's left." Sections are re-sent on every run,
so the path survives compaction, which is Claude Code's plan re-injection without re-sending the whole plan. The
path comes from the seed message or the dialog's `submittedPlan`, saved in the module's state so `/reload` keeps it.
Pairs with [plan-build slice 9](plan-build.md#slices) (Clear context by default): fresh sessions for big
plans, and the plan stays findable in long ones.

### C: steer the summary

Pi's `session_before_compact` hook cannot add instructions to pi's summary: it can cancel or return a complete
compaction result. MyPi therefore calls pi's exported `compact()` itself, combining `/compact <text>` with fixed
instructions to keep user decisions and why, the plan path, files changed and still to change, open questions, and the
next step. It drops file contents and tool output, which can be read again. If there is no model or the call fails,
MyPi warns (on failure) and lets pi summarize normally; it never cancels compaction.

The call uses the event's model and its resolved auth (key, headers without the ones pi marks `null` for removal,
and `env`), which works with a subscription (OAuth) login. Pi's own call also passes its routing, thinking level,
stream function, and retry settings, which an extension can't reach; `compact` uses its defaults for those.

Tried live (2026-10-25, gpt-6-luna on a ChatGPT subscription login, throwaway repo): after three file reads and two
decisions, `/compact` compacted 35,310 tokens with no warning. The compaction entry says `fromHook: true`, so
MyPi's call made it. The summary kept "use SQLite: Node has it built in", the plan file's path, and "write the
schema" as the next step, with no file contents, only their names. The later DuckDB decision sat in the recent
messages pi keeps whole, so it wasn't summarized and wasn't lost.

**First real compactions (2026-10-26, subagents milestone 3, checkpoint 1):** two in one session, each at about 193k
tokens. Both kept the plan path, and the second also the fix list and exactly what was left, so pi carried on. But
the second wrote "the user asked to assess name collisions" for a done-check report. pi gives the summarizer custom
messages as `[User]: <text>`, without their type, so the instructions now say that messages starting with "Done
check", "Background job", or "Subagent job" are MyPi's, not the user's, and every done-check report starts with
"Done check:" (one with only open tasks or duplicate names didn't).

### D: re-check the principles before "done"

Two lines in plan-build's Build section: before saying a slice is done, re-read "Before a slice is done" in
`docs/principles.md` (or the project's own equivalent) named in the project instructions in the context, and check the
diff against it; with no project instructions in the context, the project has none, and nothing above the folder is
theirs to look for. Prompt only. The done check already runs the tests; this covers what tests can't (names, size,
defensive code). Until 2026-10-29 the line named the project's `AGENTS.md`, and the model searched above the project
for it although the line said not to (plan-build [slice 13](plan-build.md#slices)).

### E: clear old tool results

**Measured 2026-10-25** from that day's pi sessions in MyPi: tool results were 42–87% of each session's content, and
results over about 2k tokens alone 22–53% (31 of them in the 527k-token worktree session). Read once, used, then
carried in every request until compaction. Enough to build it without waiting for analytics.

`tool-results.ts`, two pure functions, wired in `ContextModule` on pi's `context` event (it gets the messages before
each model call, without system messages, and may return them changed; the session file keeps the originals):

- `oldResultsToClear(messages, cleared)`: the tool-call IDs of results over about 8,000 characters (about 2k tokens)
  from before the last 3 user messages that aren't in `cleared` yet, returned only when together they reach about
  80,000 characters (about 20k tokens), else none. That batching keeps the prompt cache: the start of the
  conversation changes once per batch, not every turn.
- `withResultsCleared(messages, cleared)`: the messages with each cleared result's content replaced by a stub that
  names the call, from the matching `toolCall` in the assistant message before it: `[cleared to save context: read
  src/a.ts (340 lines). Call it again if you need it.]`

The module keeps `cleared`, a set of tool-call IDs, in memory: a cleared result stays cleared, IDs survive
compaction reshuffling the list, and after `/reload` the first call clears everything old and large again in one
batch, which costs nothing a reload doesn't already cost. Untouched: the last 3 user turns, small results (errors,
`ask_user`), user and assistant messages, MyPi's custom messages (done-check reports, job notices).

**Built 2026-10-25** by pi on gpt-6-luna, then tightened in review: the message type now comes from
pi-coding-agent's `ContextEvent` (not `pi-agent-core`, which MyPi doesn't depend on); the stub names any call's
`path` or `command`; and the test rows were rebuilt so each rule is the only reason for its outcome (two rows passed
whatever their rule did). Breaking any of the three rules (batching, the last 3 turns, the size floor) fails a test.

**Tried live** (gpt-6-luna, throwaway repo): after reading four files of about 30KB each, the footer's context figure
stayed at 12.8% while those reads were within the last 3 user turns, then dropped to 1.4% on the turn they fell out
of it. Asked to quote a line from one of them, the agent read just that line again (`big2.txt:7-8`) and quoted it
right. Analytics' context-use numbers will show how often that happens over real sessions.

### Subagents

[Subagents](subagents.md) are now a foundational module (decided 2026-10-25), partly for this: research
and checks run in a subagent's own context and only a summary comes back, the way Claude Code starts small
background agents for them. That keeps big reads out of the main session, which B–E only trim after the fact.

### F: messages sent mid-run are acknowledged

**Done 2026-10-28** (the user's ask). pi already shows a message sent while the agent works dimmed above the editor
(`Steering: …`) and puts it in the transcript where it's delivered, between two tool calls, but the model received it
as a plain user message and folded it in without a word, so the user couldn't tell it was read. Claude Code tells its
model such a message arrived mid-task. `withMidRunNotes` (`mid-run.ts`), on the same `context` event as E, puts
`MID_RUN_NOTE` ("The user sent this while you were working. Acknowledge it in one short line, say what changes because
of it, then continue:") before each user message that comes right after a tool result, in the model's copy only; the
transcript keeps what the user typed. A follow-up (`Alt+Enter`) arrives after the run ends, after the agent's reply, so
it's left alone. Tried live (gpt-6-luna): "also print the date at the end", sent during three `sleep 6` calls, got "Got
it—… I'll print the date afterward." before the next call; without F, the same run said nothing.

## Not taking

- Clearing the context with no choice: small plans gain nothing (plan-build slice 9).
- Re-reading the recently edited files after every compaction, as Claude Code does: pi's own summary already tracks
  file operations, and re-reading costs tokens each time; revisit if B–C aren't enough.
