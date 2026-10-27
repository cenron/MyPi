# Analytics

**Status:** slices 1–3 built 2026-10-27; slice 4 implemented and reviewed 2026-10-28, with its live check open.
Permission dialogs are the one measure that doesn't come from the session files: `ToolGuard` publishes each dialog on
the bus and the module records it as it arrives. Benchmarks remain planned.

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

- **pi's session files:** the source of truth for what happened: main sessions in
  `~/.pi/agent/sessions/<folder>/`, subagent runs in `~/.pi/agent/subagents/sessions/`. The footer gives each
  session's cost and context share; each self-build plan's Observations log carries reviewed measures per checkpoint.
- **The module:** reads both session-file folders into one local database shared across pi windows and projects. It
  indexes existing history and appended complete JSONL lines; no transcript content is retained.
- **The bus, for the one thing the files don't hold:** permission dialogs. `ToolGuard` publishes each one on the
  `approval` channel after its choice ([architecture](../architecture.md)), and the module records it as it arrives.

## What to measure

| Area | Question | Signal | Kind | Decides |
|---|---|---|---|---|
| Tokens and cost | Which model and effort level is worth it for which work? | `usage` on each assistant message: input, output, cache read and write, cost | counted | Defaults per task kind; whether high thinking pays |
| Cache | Does a prompt or module break caching? | Cache-read share of input over time | counted | Which prompt changes to undo |
| Context | Do sessions run out of room, and does clearing old results help? | Peak context per session, compactions, turns after the first one, re-reads of a file an earlier result held, share of context in old tool results | counted | Compaction and [context](context.md) thresholds |
| Tool calls | Which tools fail, and how? | Calls and `isError` per tool, failure text grouped; blocked calls (guard, Plan) apart | counted | Which tool to fix first |
| Shell without a tool | What does the agent keep doing in `bash`? | Command names from `tokenize` (each part of a pipeline, when it can parse the line) | counted | Candidates for a built-in tool |
| Code navigation | Does the agent find code by symbol or by text? | `lsp` calls; `rg`/`grep` searches outside `node_modules` (a flag; arguments aren't kept); `read` from line 1 vs a later part; the `lsp` share (`lsp / (lsp + code searches)`) | counted | Whether the [LSP nudge](lsp.md#slices) stays, and whether a third one is needed |
| Done check | Does it catch anything, and does the next round fix it? | Reports sent back (errors, failed commands, open tasks), pass lines, rounds, whether the next report was smaller | counted | Whether the check pays; its round limit |
| Todo | Is the list used, at the right size, and finished? | Task tool calls per run; tasks per plan step (one per box, or one per checkpoint); tasks left open at the end; reminders sent and whether a task tool call followed within a few requests; open-task reports from the done check | counted | Seeding wording; the reminder interval; whether the open-task report earns its place |
| Subagents | Which agents are used, what they cost, what they catch | Runs per agent, model, effort; tokens, cost, time, outcome, refusals; summed under the prompt that started them (from the child's own session) | counted, plus reviewed for "caught a real bug" | Which model for reviews; whether a builtin is worth keeping |
| Memory | Are memories missed? | Runs that changed files outside `.pi/` and how many also wrote a memory; prompts with a stated preference and no memory after | counted | Whether to build the end-of-run nudge (see [memory](memory.md#saving-without-being-asked)) |
| Friction | How often does MyPi stop the agent to ask, and is it right? | Permission dialogs per model and per rule, broken down by choice; which were false is reviewed | counted, plus reviewed | Folder-guard and Plan rules to loosen or fix |
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
  catches a renamed copy with no question asked. Decided: the [duplicate check](../roadmap.md) (row 14) is MyPi's own (the LSP
  name lookup), with no ripwire in it, since not every system has ripwire; ripwire's skills are hidden from pi for the
  rest of milestone 2 and measured on their own in milestone 3 (rebuilt count, `lsp` share, `ripwire` calls).
- **2026-10-26, LSP after the nudge** (subagents milestone 2, checkpoints 1–4, gpt-6-luna, high, ripwire's skills
  hidden): `lsp` share 50%, 50%, 80%, 25%; **16 `lsp` calls against 14 code searches, 53%**, against the 6.8%
  baseline. Same model and thinking; four sessions. Decided: keep the nudge; no third nudge for now; keep measuring.
- **2026-10-26, self-builds, rows 11–12 → milestone 2** (6 and 5 checkpoints, gpt-6-luna, high): passes per checkpoint
  1.2 → 1.2; early stops 0 → 0; rebuilt helpers 1 → 4 (3 in one checkpoint); real problems caught by pi's own
  reviewer subagent 1 → 6 (after it started checking the plan's boxes); bugs past all of pi's checks 2 → 2, both
  visible only on screen or in the model's behavior (literal `<accent>` tags; a parent asking writers for their own
  patches); per-box task tracking from the plan wording; false folder-guard prompts 10 → about 0; cost per checkpoint
  $0.094 → $0.181; context at the end 42% → 48%. The open-task report never fired in 11 checkpoints (pi always
  finished its list). Decided: the duplicate check (row 14) next; live checks read the screen with colors and phrase
  prompts as a user would.

- **2026-10-26, the duplicate check's first catch** (row 14, gpt-6-luna, high): in a live check phrased as a user
  would, the model wrote its own `formatPrice` next to an existing one; the done check named both and the model
  imported the existing one. The first time a done-check report changed what a model did. Measure from here: the
  "rebuilt instead of reused" count in milestone 3 (with ripwire's skills on) against milestone 2's 4.
- **2026-10-26, ripwire's skills on** (subagents milestone 3, 2 checkpoints, gpt-6-luna, high, no nudge): 11 `ripwire`
  calls, all `--help`, `--quality-delta`, or `--quality-panel` after writing; none of the lookups that find an
  existing helper (`--for`, `--clones`). Rebuilt helpers 4 → 4; `lsp` share 53% → 60% (6/4); cost per checkpoint
  $0.181 → $0.50, mostly from the first compactions (3). Decided: no change to MyPi; ripwire stays hands-off, and the
  duplicate check stays MyPi's way to catch rebuilds. Over $0.2 a checkpoint, so checkpoints get smaller.
- **2026-10-26, the duplicate check's false alarms and their fix.** On pi's own work it reported imported names and a
  private `parameters` constant every tool file has. Fixed by checking only names declared in the file and only
  functions, classes, interfaces, and enums; the next checkpoint copied a constant (`LIST_HEIGHT`) it then missed.
  Decided: keep constants out (a name lookup can't tell a copy from a common name); the reviewer agent looks for
  copied constants.
- **2026-10-26, a full ripwire pass over MyPi** (at `d3b4844`): it found what the reviews didn't, all shapes: two
  copies of a toggle dialog (`/lsp`, `/modules`), `inBuild` and `isPlanMode`, the `subagent` tool's complexity
  (7 → 16), two growing classes, and untested wiring (`/worktree list`/`remove`, the subagents module). Every
  behavior bug of milestone 3 came from reviews and live checks instead. Security triage clean. Decided: one cleanup
  row for the five; run the full pass after each milestone.
- **2026-10-26, the cleanup row** (row 16, 2 checkpoints, gpt-6-luna, high): one pass each, nothing rebuilt, cost per
  checkpoint $0.105 (against milestone 3's $0.50) with no compaction, net −18 lines. The `subagent` tool's `execute`
  went from 16 to 7 branches. Each review still found something: a lost comment, a defensive guard, a two-line `if`
  without braces. Removing one copy exposed another (the dialog list, hidden behind the theme). pi made 0 `lsp` and
  0 `ripwire` calls in both checkpoints, with 10 code searches: refactoring known files didn't need lookups. pi's
  reviewer subagent can't run the tests (read-only, no one to approve). Decided: small checkpoints are the default.
- **2026-10-27, the measuring script retires.** On the same 14 MyPi sessions, `/analytics` counted the same 9 `lsp`
  calls, 38 `rg`/`grep` calls, and 67 reads from line 1 as the deleted script. A code-search flag (no arguments kept)
  reproduces the script's 25 searches outside `node_modules`: the 13 finished sessions matched one by one, and the
  running session had grown since the script read it. Tool calls differed by 7 for the same reason. Decided: the script
  is gone; `/analytics` is the count.

- **2026-10-27, analytics milestone 1, built by three models on real work** (one plan, four checkpoints, high
  thinking): GPT-6 Luna built checkpoints 1 and 3 ($0.50 and $0.37 on its subscription, two passes each, one
  compaction each); DeepSeek V4.1 Flash built checkpoint 2 for $0.20, about 3% of OpenCode Go's 5-hour window, in two
  passes with no compaction, but reached outside the repo most (9 folder-guard prompts: 2 declined, 4 false, which
  led to the guard reading MyPi's own data and ignoring `sed` scripts); Qwen 3.8 Max spent $2.29 on the smallest
  checkpoint and hit the Go 5-hour limit before finishing (Luna finished it). The done check's open-task report fired
  on pi for the first time (checkpoint 3). Decided: Luna and DeepSeek for building; Qwen only when its quality is
  worth about 13× the price, and not on the Go plan's 5-hour budget.
- **2026-10-27, the first full report** (all indexed history, 2026-10-18 to 2026-10-27, 328 MyPi sessions, nearly
  all on the 25th and 26th; costs are list prices, not what a subscription billed):
  - **Subagents are not the cost.** Subagent sessions (`subagents/sessions/`) spent $0.96 of $17.25 (6%) in 878 of
    6,663 replies, about $0.03 a run on gpt-6-luna. A first count said 84%: it took every session with a parent link
    for a subagent, but `/plan implement` sessions carry one too, and the expensive ones (gpt-6.1-sol $6.69, Qwen 3.8
    Max $2.54) were those build sessions. A report grouping by parent link has to tell the two apart.
  - **Subagents hit approval walls.** 76 "no one can give it here (no UI)" refusals, all inside subagents: 56 from
    Plan's rule (tests, chained lines, `cd` before a reader), about 20 from the folder guard. `e921173` (approved
    checks) and `26344d2` (`cd`) fixed most; the refusals after them came from two pis started before `26344d2`. Left:
    writers in a worktree handed the main checkout's paths, and approved checks inside a longer line.
  - **herdr is the most-run shell command** (775 calls, 93 failed): many failures print herdr's own help (a wrong
    subcommand), 37 are `agent_prompt_stalled`, 9 are `wait-output` timeouts. pi driving pi needs a wrapper or a
    short syntax sheet.
  - **`bash`'s failure share misleads.** 18% of calls failed, but 297 of the 389 failures outside herdr are `npm` or
    `npx`, mostly test and typecheck runs exiting non-zero while building. The report can't tell a non-zero exit from
    a broken call.
  - **Lifetime numbers hide a change.** gpt-6-luna's `lsp` share is 10.5% over all history against 53–60% in the
    windows measured after the nudge; the 7-day default now covers almost everything. The report can't yet measure
    "the same way after" (step 4 of the loop).
  - **Settled:** cache-read share is 96–99% on every hosted model, so caching isn't where tokens go. Per reply,
    gpt-6-luna and DeepSeek V4.1 Flash cost about 0.1¢, gpt-6.1-sol about 0.95¢, Qwen 3.8 Max about 2¢. DeepSeek
    writes the longest replies (555 output tokens each) and has the lowest `lsp` share (2%). One permission dialog
    recorded so far: too few to read.

  Decided: subagents keep `inherit`; fix writers' paths and checks in a longer line, and split non-zero exits from
  other failures; then start over from an empty history (the sessions indexed here went to the Trash) and measure the
  next work. Still open: a date or per-milestone window for `/analytics`, and herdr usage errors.

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

- One SQLite database at `join(getAgentDir(), "analytics", "analytics.sqlite")`, outside the repo, shared by every pi
  window. It stores per-file indexing progress, one row per assistant reply or `usage` entry, one row per tool call
  (settled by its result, including a code-search flag), one row per shell command name in a `bash` call, and
  content-free MyPi feature rows, and one row per rule of each permission dialog, written live as the dialog ends.
  Only MyPi's sessions count (the user's call, 2026-10-26): every session in
  `subagents/sessions/` (only MyPi writes there); a session with the `mypi-session` marker (`Session.markAsMyPi`,
  once per session) or a MyPi entry or tool in its first 16 lines; and a session from before the marker
  (2026-10-27), read in full once and kept if it shows a MyPi tool or notice anywhere. Other pi sessions are
  remembered by path only and never indexed. Subagent
  headers retain their `parentSession` link; the parent subagent call's agent name is kept to group child cost. The
  session files are the source of truth, and indexed and skipped paths are removed when their transcript files
  disappear.
- Built with Node's `node:sqlite` `DatabaseSync`, WAL mode, and a 5-second busy timeout. A file's rows and progress
  are written in one transaction. The `schema_version` is rebuilt from session files when it changes.
- Indexing is incremental: it resumes at the byte offset after the last complete line. Shrunk files and files whose
  header session id changed are reindexed. Every branch entry counts; the tree is not filtered to its current leaf.
- Permission dialogs have no file to index, so they're written as they happen: one row per asking rule, sharing a
  random dialog id, which lets the report count a dialog once however many rules asked. They stay when a session file
  is deleted, since none of them belongs to a file.

## Privacy

- Record command names, never full command lines or arguments: they can hold paths, secrets, or private data.
- Only MyPi sessions are indexed. Other pi sessions contribute only their file path to the local skip list; `/analytics`
  reports the number skipped without showing paths. No file contents, prompts, or replies. Usage rows keep provider,
  model, thinking level, usage counts, cost, stop reason, timestamp, session id, and project folder. Tool-call rows keep the same session and model columns plus the
  tool name, the failure flag, whether a `bash` call is a code search, shell command names (with the home folder
  written `~`), the read starting line, and a failure's first line cut to 120 characters, home shortened to `~`. A
  failure's first line can quote the path or input it failed on; it stays short and local for that reason. Feature rows
  store only done-check report/pass and job-notice kinds and timestamps. Task tool calls are already counted by tool
  name; subagent calls keep only the agent name, not their task argument. Child sessions keep the parent session path.
- A permission dialog keeps only its rules, its choice, the model, and the time: never the question, which quotes the
  command or path it asks about.
- Local only: nothing leaves the machine.
- **In the reports, too:** only counts and short failure lines go into tracked docs; never raw session data, session
  paths, or anything from a user's own files. Per-checkpoint detail stays in git-ignored plans.

## Behavior

- When loaded, it indexes eligible MyPi session files in the background and indexes again before reporting. A pi
  session started after the marker is checked only through its first 16 lines; an excluded path is remembered and
  never read again, even if it grows. `/analytics` reports the count of skipped sessions. No pi hot-path events are used for analytics data.
- `/analytics` shows the last 7 days; `/analytics all` shows all indexed history. Sections:
  - **Model usage:** one compact line per provider, model, and thinking level with replies, input, output, cache-read
    share, and cost. Usage entries contribute tokens and cost but not reply counts; token counts use the footer's
    compact units.
  - **Tools:** calls and the failure share per tool, then the five most frequent failure lines.
  - **Shell commands with no tool:** the most-run command names (up to eight), leaving out `grep`, `find`, `ls`, and
    `cat`, which pi has tools for. Names come from `tokenize`, so a command with a file redirect, heredoc, or variable
    gives none.
  - **Code navigation:** per model, `lsp` calls, code searches (`rg`/`grep` in `bash` with no `node_modules` in the
    command, plus the `grep` and `find` tools), reads from line 1, and the `lsp` share.
  - **MyPi features:** done-check reports and passes per model (attributed to the latest preceding usage in the same
    session), task-tool calls and sessions that used them per model, and subagent runs and summed child cost by agent,
    model, and thinking level. Child cost is included from the child's indexed usage rows and linked through
    `parentSession`.
  - **Permission dialogs:** per model and per rule, how many dialogs ended in each choice (yes, no, allow for this
    session, no UI).
- Can be turned off with `/modules`, and the database deleted to start over.

## Slices

1. **Built 2026-10-26:** SQLite store, incremental session-file indexer, assistant and `usage` rows, and the first
   `/analytics` summary. This is the baseline.
2. **Built 2026-10-27:** tool-call rows with failure status, a code-search flag, shell command names, and read
   starting lines; the tools, failure, shell-command, and code-navigation sections; the handwritten measuring script
   retired.
3. **Built 2026-10-27:** the `MyPi features` report section counts done-check reports and passes by model, task-tool
   calls and sessions that used them, and subagent runs by agent/model/thinking with child cost summed from the linked
   session files. The index keeps only notice kind and timestamp; it links child headers through `parentSession` and
   retains the parent's subagent agent name, never the task argument. The follow-up restricts indexing to MyPi sessions
   and reports how many other pi sessions were skipped.
4. **Built 2026-10-28:** permission-dialog friction. `ToolGuard` publishes each dialog and each no-UI refusal on the
   bus's `approval` channel after its choice; the module records it live into the same database, and `/analytics` gains
   the `Permission dialogs` section.

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
