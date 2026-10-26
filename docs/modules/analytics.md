# Analytics

**Status:** idea (recorded 2026-10-22). Not built yet; measured by hand during MyPi's self-builds since 2026-10-26
(see [Findings](#findings)), which shapes what the module will collect.

## Goal

Metrics that last across sessions and pi instances, so MyPi is improved from evidence, not hunches: which tools fail,
which models waste tokens or miss the cache, which shell commands the agent keeps reaching for because MyPi has no
tool for them, and whether MyPi's own features (the done check, todo, subagents, LSP, memory) change what the agent
does. Every number is kept per model and per effort (thinking) level, since they behave differently. A module, so it
can be turned off. Later, the same metrics on a fixed set of tasks, to compare models ([Benchmarks](#benchmarks-later)).

## How we use the data

Every number exists to settle a decision. The loop, as worked out building MyPi with pi (2026-10-26):

1. **A question tied to a decision.** "Does the agent use `lsp`?" decides whether to nudge it; a number that decides
   nothing isn't collected.
2. **A baseline before any change**, from the sessions already on disk, with the model, thinking level, and window
   written down (for example: 19 MyPi sessions, gpt-6-luna, high).
3. **Change one thing**, and say what else changed at the same time. Milestone 1 → rows 11–12 changed the thinking
   level, the plan format, and the features at once, so the drop in early stops can't be credited to any one of them.
   Write such confounders next to the result.
4. **Measure the same way after**, on comparable work, same model and thinking level.
5. **Keep, revise, or remove.** A nudge or feature that doesn't move its number is removed (ripwire's lesson below);
   one that moves it stays, and its number keeps being watched.
6. **Record it in [Findings](#findings)** with the date, the numbers, the window, and what was decided.

Two kinds of measure, kept apart:

- **Counted:** read from session files or events with no judgment (tool calls, tokens, cost, done-check reports,
  task tool calls, dialogs). The module can collect these.
- **Reviewed:** need a person or a reviewer to judge (an API rebuilt instead of reused, a rule with no failing test,
  a spec detail changed silently, a wrong claim in a self-report, a false folder-guard prompt). These stay in each
  plan's Observations log and the post-mortems; analytics records only the counted side and points to them.

## Where the data comes from

- **Now (by hand):** pi's session files, the source of truth for what happened: main sessions in
  `~/.pi/agent/sessions/<folder>/`, subagent runs in `~/.pi/agent/subagents/sessions/`. A local script in the
  git-ignored `.pi/plans/measure-tool-use.py` counts code navigation per session (`lsp` calls, `rg`/`grep` searches
  outside `node_modules`, reads from line 1, reads of a later part, shell reads). The footer gives each session's cost
  and context share. Each self-build plan's Observations log carries these per checkpoint.
- **Later (the module):** pi's events, as below, into one local database, so the same numbers come without a script
  and across every project.

## What to measure

| Area | Question | Signal | Kind | Decides |
|---|---|---|---|---|
| Tokens and cost | Which model and effort level is worth it for which work? | `usage` on each assistant message: input, output, cache read and write, cost | counted | Defaults per task kind; whether high thinking pays |
| Cache | Does a prompt or module break caching? | Cache-read share of input over time | counted | Which prompt changes to undo |
| Context | Do sessions run out of room, and does clearing old results help? | Peak context per session, compactions, turns after the first one, re-reads of a file an earlier result held, share of context in old tool results | counted | Compaction and [context](context.md) thresholds |
| Tool calls | Which tools fail, and how? | Calls and `isError` per tool, failure text grouped; blocked calls (guard, Plan) apart | counted | Which tool to fix first |
| Shell without a tool | What does the agent keep doing in `bash`? | Command names from `tokenize` (each part of a pipeline) | counted | Candidates for a built-in tool |
| Code navigation | Does the agent find code by symbol or by text? | `lsp` calls by action; `rg`/`grep` searches outside `node_modules`; `read` from line 1 vs a later part; the `lsp` share (`lsp / (lsp + code searches)`) | counted | Whether the [LSP nudge](lsp.md#slices) stays, and whether a third one is needed |
| Done check | Does it catch anything, and does the next round fix it? | Reports sent back (errors, failed commands, open tasks), pass lines, rounds, whether the next report was smaller | counted | Whether the check pays; its round limit |
| Todo | Is the list used, at the right size, and finished? | Task tool calls per run; tasks per plan step (one per box, or one per checkpoint); tasks left open at the end; reminders sent and whether a task tool call followed within a few requests; open-task reports from the done check | counted | Seeding wording; the reminder interval; whether the open-task report earns its place |
| Subagents | Which agents are used, what they cost, what they catch | Runs per agent, model, effort; tokens, cost, time, outcome, refusals; summed under the prompt that started them (from the child's own session) | counted, plus reviewed for "caught a real bug" | Which model for reviews; whether a builtin is worth keeping |
| Memory | Are memories missed? | Runs that changed files outside `.pi/` and how many also wrote a memory; prompts with a stated preference and no memory after | counted | Whether to build the end-of-run nudge (see [memory](memory.md#saving-without-being-asked)) |
| Friction | How often does MyPi stop the agent to ask, and is it right? | Permission dialogs per session (asked, allowed, declined); which were false is reviewed | counted, plus reviewed | Folder-guard and Plan rules to loosen or fix |
| Self-builds | Is pi getting better at building MyPi? | Per checkpoint: passes, early stops, cost, context (counted); rebuilt APIs, untested rules, silent spec changes, wrong self-reports (reviewed) | both | Plan format, which features to build next |

## Findings

Dated, with the window and model; newest last. Each says what was decided.

- **2026-10-25, LSP, first data point.** One session planning worktree (gpt-6.1-sol, medium, TypeScript server
  installed, `lsp` active): 0 `lsp` calls out of 87 (55 `read`, 20 `bash`). Most `rg` searched compiled
  `node_modules`, where `rg` fits; a few searched MyPi's `src/` for names, which `find_symbol` or `references` could
  have answered. An anecdote, not a rate; decided to measure more before any nudge.
- **2026-10-26, wording that says *when* changes behavior.** Subagents: the model didn't delegate until the prompt
  and tool description said when to (milestone 1, checkpoint 3). Todo: with a one-sentence description, the model
  made one task for a three-step request; with Claude Code's descriptions copied nearly word for word, it tracked the
  same request in three. Decided: new tools and nudges are worded like Claude Code's, leading with when to use them.
- **2026-10-26, self-builds, milestone 1 → rows 11–12** (6 checkpoints each, gpt-6-luna; medium then high): passes
  10 → 7; early stops 4 of 5 → 0; APIs rebuilt 3 → 1; rules with no failing test 4 → 0; interactive live checks by pi
  0 of 6 → 6 of 6; cost per checkpoint $0.052 → $0.094; context at the end 32% → 42%. Confounded: the thinking level,
  the plan format, and the features all changed together. Details in the self-build post-mortem (local).
- **2026-10-26, todo granularity.** Pi used the task tools while building in 3 of 3 checkpoints after they existed,
  but always as one task per checkpoint; after the plan asked for "one task per box", it made one per box (5 for 5).
  The done check's open-task report never fired on pi, since it always finished its list. Decided: keep the seeding
  wording, and record the granularity per checkpoint in subagents milestone 2.
- **2026-10-26, friction.** 10 false folder-guard prompts in 6 checkpoints, all from pi driving another pi: 3 from
  the temp folder's real path, 7 from quoted slash commands sent through herdr. Both causes fixed; decided to keep
  counting dialogs per checkpoint.
- **2026-10-26, done check.** It passed every run and sent nothing back; the pass line it now shows revealed
  "lsp checked 50 changed files" on every MyPi run (generated `coverage/` files). Fixed: git-ignored files are skipped.
- **2026-10-26, LSP baseline before the nudge.** 19 MyPi sessions (gpt-6-luna, high, self-build checkpoints and their
  live checks): **3 `lsp` calls, 41 code searches, 316 reads from line 1, 76 later-part reads; `lsp` share 6.8%**.
  Decided: build the nudge ([lsp](lsp.md#slices) slice 7: the tool description, and a prompt section only while a
  server can answer) and measure it over subagents milestone 2's checkpoints 1–4, same model and thinking. First
  live checks after it: one model used `lsp` for "where is X used?", another used `rg` with the section in its prompt.
  If the share barely moves, try the third nudge (a hint on the result of an `rg` or whole-file `read`); if that
  doesn't move it either, remove the nudges.

- **2026-10-26, rebuilt instead of reused.** pi rebuilt helpers the plan named minutes earlier: 3 in milestone 1, 1
  in rows 11–12, 3 in milestone 2's checkpoint 3 alone (the reviewer rebuilt one too). ripwire, tested on that
  checkpoint: the narrow question finds the helper first every time, the whole-task question 2 of 3, and `--clones`
  catches a renamed copy with no question asked. Decided: the [duplicate check](../roadmap.md) (row 14) uses the clone
  check where ripwire is installed and the LSP name lookup otherwise, measured by the "rebuilt" count. Confounder from
  here on: ripwire's 17 skills are in every pi session's prompt (including one for "about to write one symbol").
- **2026-10-26, LSP after the nudge** (milestone 2 checkpoints 1–3, gpt-6-luna, high): `lsp` share 50%, 50%, 80%
  (3/3, 3/3, 8/2 `lsp` calls/code searches), against the 6.8% baseline. Three sessions; the post-mortem gives the
  milestone's total.

## What pi offers

Checked against the installed pi 1.2.0 (2026-10-22):

- **Events** an extension can listen to: `message_end` (an assistant message carries `usage`: `input`, `output`,
  `cacheRead`, `cacheWrite`, and `cost`), `tool_execution_end` and `tool_result` (with `isError`), `tool_call` (where
  MyPi's tool guard already runs), `turn_end`, `model_select`, and `thinking_level_select`.
- **The model and effort** are on the context (`ctx.model`) and `pi.getThinkingLevel()`.
- **No telemetry hook for extensions.** pi has a package, `@earendil-works/pi-telemetry` (counters, histograms, typed
  metric schemas, no backend), and pi-durable uses it, but the installed `pi-coding-agent` doesn't give extensions a
  telemetry context. So the module collects from events. Worth checking again on a newer pi: if pi starts passing a
  `TelemetryContext`, the module could be an adapter for it instead.
- **SQLite without a dependency:** Node's built-in `node:sqlite` (pi runs on Node 25 here). pi-durable ships a SQLite
  storage on it, `openNodeSqliteStorage(path)` from `@earendil-works/pi-durable/storage/sqlite/node`.
- **Other parts publish what they know on the [event bus](done-check.md#the-event-bus)** (a done-check report, a
  todo change, a subagent run's end), and analytics listens, so neither imports the other and each can be turned off.

## Storage

- One SQLite database under `~/.pi/` (outside the repo, so nothing personal is committed), shared by every pi window:
  one row per event or a running total per (model, effort, day), to decide.
- Several pi instances write at once, so the database runs in WAL mode with a busy timeout, and every write is a
  short transaction.
- **Sharing it with pi-durable** (for [subagents](subagents.md)): possible in the same file, but pi-durable says "one
  process owns a storage at a time", and several pi windows write analytics at once. So likely the same folder,
  separate files: `analytics.sqlite` for this module, and pi-durable's per-session files beside it.

## Privacy

- Record command names, never full command lines or arguments: they can hold paths, secrets, or private data.
- No file contents, prompts, or replies; only counts, sizes, names, and failure text cut short.
- Local only: nothing leaves the machine.
- **By hand, too:** the measuring script reads arguments locally to classify calls but prints only counts and each
  session's first-prompt snippet; only aggregates go into tracked docs (this file, module docs), never raw session
  data, session paths, or anything from a user's own files. Per-checkpoint detail stays in git-ignored plans.

## Behavior

- Collects silently while loaded; the session isn't slowed (writes are batched or quick).
- A command, such as `/analytics`, shows a summary: tokens and cache share per model and effort, the most-failed tools,
  the most-run shell commands with no tool, the code-navigation mix, and each feature's numbers from the table above.
- Can be turned off with `/modules`, and the database deleted to start over.

## Lessons from other projects

- **Measure before steering.** ripwire nudged agents toward its tool when they reached for grep or a whole-file
  read, then ran a randomized A/B over hundreds of sessions and found the nudge did nothing, so it was removed. Serena
  ships the same kind of nudge. So a nudge comes with a baseline and a measurement after, and goes if it does nothing
  (step 5 of the loop).
- **A cheap check for each new tool.** Serena's evaluation is one prompt: the agent does about 20 tasks both ways,
  with the tool and with its built-ins, counts calls and output size, checks the edits with `git diff`, and reports
  where the tool helped and where it didn't. Use the same kind of prompt for a new MyPi tool or module until the
  benchmarks below exist; for `lsp`, it's the next step if milestone 2's numbers are unclear.

## Benchmarks (later)

When a new model comes out, run it through a fixed set of tasks and compare it with the others on the same metrics:
the passive numbers above come from everyday work, so they can't tell two models apart on the same job.

- **Tasks:** small, repeatable jobs in throwaway fixture repos, each with a check that decides pass or fail (tests
  pass, a file has the right content, a question is answered correctly). Mixed on purpose: a bug fix, a refactor, a
  plan in Plan mode, a web search, a long-running command (background jobs), a task that needs a tool MyPi has.
- **Running:** pi headless, one model and effort level at a time (`pi -p --mode json --model <provider/id>
  --thinking <level>` in a fresh copy of the fixture), with MyPi loaded so its tools and modules are part of what's
  measured. Several runs per task, since one run is noise.
- **Results:** into the same database, tagged with the benchmark run, so `/analytics` can show a model's everyday
  numbers next to its benchmark ones: pass rate, tokens and cost per task, cache share, tool failures, turns, time.
- **Uses:** pick defaults per task kind (which model for planning, which for small edits), see whether a MyPi change
  helped (run the same suite before and after), and check a local model against hosted ones.
- Open: where the tasks live (in this repo under `bench/`, or their own repo), how to keep a fixture from leaking into
  the model's context as a known answer, and what a run costs on paid models.

## Open questions

- Event rows or running totals? Rows allow any later question; totals stay small.
- Exactly where under `~/.pi/` (pi's agent dir `~/.pi/agent/`, or a `~/.pi/mypi/` folder)?
- How to group failure messages so the same failure counts once?
- Which commands count as "has no tool": everything except a short list MyPi already covers (`grep`, `find`, `ls`,
  `cat` have pi tools), or all of them, filtered in the report?
- Does the report live in pi (`/analytics`) only, or also as a file or an Artifact to read outside pi?
- Should the reviewed measures get a light structure (a few fixed fields in each Observations line) so they can be
  counted across plans, or stay prose?

## References

- [ripwire](../inspiration/ripwire.md): a local tool-call log and an A/B that found its nudge hook did nothing
- [Serena](../inspiration/serena.md): an evaluation prompt where the agent does each task both ways and reports
