# Analytics

**Status:** idea (recorded 2026-10-22)

## Goal

Metrics that last across sessions and pi instances, so MyPi can be improved from evidence: which tools fail, which
models waste tokens or miss the cache, and which shell commands the agent keeps reaching for because MyPi has no tool
for them. Every number is kept per model and per effort (thinking) level, since they behave differently. A module, so
it can be turned off. Later, the same metrics measured on a fixed set of tasks, to compare models (see
[Benchmarks](#benchmarks-later)).

## What to track

- **Tokens**, per model and effort level: input, output, cache read, cache write, and cost, from each assistant
  message's `usage`.
- **Cache use**: the cache-read share of input over time, to spot prompts or modules that break caching.
- **Tool calls**: how often each tool is called, and how often it fails (`isError`), with the failure text grouped so
  repeated failures stand out. Blocked calls (the tool guard, plan-build's rule) counted apart from failures.
- **Shell commands without a tool**: the command names inside `bash` calls (`git`, `curl`, `jq`, `sed`, …), counted.
  A command the agent runs often is a candidate for a built-in tool. `tokenize` in `src/core/util/shell.ts` already
  splits commands, so each part of a pipeline or `&&` chain counts.
- Later, possibly: turns per prompt, time per tool, compactions, which modules were loaded.

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

## Storage

- One SQLite database under `~/.pi/` (outside the repo, so nothing personal is committed), shared by every pi window:
  one row per event or a running total per (model, effort, day), to decide.
- Several pi instances write at once, so the database runs in WAL mode with a busy timeout, and every write is a
  short transaction.
- **Sharing it with pi-durable** (for [subagents](subagents.md)): possible in the same file, but pi-durable says "one
  process owns a storage at a time", and several pi windows write analytics at once. So likely the same folder, separate
  files: `analytics.sqlite` for this module, and pi-durable's per-session files beside it. To check when subagents are
  designed.

## Privacy

- Record command names, never full command lines or arguments: they can hold paths, secrets, or private data.
- No file contents, prompts, or replies; only counts, sizes, names, and failure text cut short.
- Local only: nothing leaves the machine.

## Behavior

- Collects silently while loaded; the session isn't slowed (writes are batched or quick).
- A command, such as `/analytics`, shows a summary: tokens and cache share per model and effort, the most-failed tools,
  and the most-run shell commands that have no tool.
- Can be turned off with `/modules`, and the database deleted to start over.

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
  helped (run the same suite before and after), and check a local model (LM Studio) against hosted ones.
- Open: where the tasks live (in this repo under `bench/`, or their own repo), how to keep a fixture from leaking into
  the model's context as a known answer, and what a run costs on paid models.

## Open questions

- Event rows or running totals? Rows allow any later question; totals stay small.
- Exactly where under `~/.pi/` (pi's agent dir `~/.pi/agent/`, or a `~/.pi/mypi/` folder)?
- How to group failure messages so the same failure counts once?
- Which commands count as "has no tool": everything except a short list MyPi already covers (`grep`, `find`, `ls`,
  `cat` have pi tools), or all of them, filtered in the report?
- Does the report live in pi (`/analytics`) only, or also as a file or an Artifact to read outside pi?

## References

- [ripwire](../inspiration/ripwire.md): a local tool-call log and an A/B that found its nudge hook did nothing
- [Serena](../inspiration/serena.md): an evaluation prompt where the agent does each task both ways and reports
