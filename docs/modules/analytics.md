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
- **Sub-agent runs** (the [subagents](subagents.md) module comes first, so this is built in from the start): tokens,
  cost, time and outcome per run, keyed by agent, model and effort, and added up under the parent prompt that started
  them. A child's usage comes from its own session's events, not the parent's `message_end`. This is how "which
  model is worth it for reviews" becomes a number.
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

## Measuring what MyPi adds

Two lessons from the [inspiration](../inspiration/README.md) projects:

- **Measure before steering.** ripwire nudged agents toward its tool when they reached for grep or a whole-file
  read, then ran a randomized A/B over hundreds of sessions and found the nudge did nothing, so it was removed. Serena
  ships the same kind of nudge. So no hints or blocks that push the agent toward a tool (LSP instead of grep, ripwire
  instead of read) until this module shows how often the agent uses the tool and whether a hint changes that.
- **A cheap check for each new tool.** Serena's evaluation is one prompt: the agent does about 20 tasks both ways,
  with the tool and with its built-ins, counts calls and output size, checks the edits with `git diff`, and reports
  where the tool helped and where it didn't. Use the same kind of prompt for each new MyPi tool or module until the
  benchmarks below exist.
- **Done-check catches** (moved from [done-check](done-check.md) slice 3, 2026-10-24): how often a Build run is sent
  back, for LSP errors or failed commands, and whether the next round fixed them or the agent explained them away,
  per model. The done check publishes a notice on the [event bus](done-check.md#the-event-bus) for each report;
  analytics listens, so neither imports the other.
- **Memory saves.** Count, per model, runs that changed files (a successful `write`/`edit` outside `.pi/`) and how
  many of those also wrote a memory, plus what a session's prompts said (a stated preference or correction) when no
  memory followed. A temporary end-of-run nudge tested on 2026-10-23 got a model that saved nothing on its own to save
  at once (see [memory](memory.md#saving-without-being-asked)); build that nudge only if these numbers show memories
  being missed.
- **LSP use, a first data point (2026-10-25).** In one pi session planning and spiking worktree in the MyPi folder
  (gpt-6.1-sol, medium), with the TypeScript server installed and `lsp` active in both modes, the agent made 0 `lsp`
  calls out of 87: 55 `read`, 20 `bash`, 5 `write`, 3 `edit`, 3 `ask_user`, 1 `job_list`. Most `rg` calls searched
  pi's compiled `node_modules/…/dist/*.js` for text, where `rg` fits; a few searched MyPi's own `src/` for names
  (`rg -n 'folderGuard|input.path|writableDirs' src/rule`, `rg -n 'execFile|promisify' src`), where `find_symbol`
  or `references` could have answered, and many whole-file reads could have started with an `outline`. One session
  is an anecdote, not a rate.
  - **Next, before any nudge** (deferred 2026-10-25, to do later): the cheap check above for `lsp` on MyPi, about 20
    tasks with `lsp` and with only `rg`/`read`, counting calls, output size, and the edits' correctness. Then decide
    whether a prompt guideline is worth it, and measure it if one is added.

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

## References

- [ripwire](../inspiration/ripwire.md): a local tool-call log and an A/B that found its nudge hook did nothing
- [Serena](../inspiration/serena.md): an evaluation prompt where the agent does each task both ways and reports
