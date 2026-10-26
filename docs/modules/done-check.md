# Done check

**Status:** done 2026-10-24 (slices 1 and 2). Counting how often it catches something moved to [analytics](analytics.md#what-to-measure).

## Goal

When the agent is about to stop, check the files it changed before I look at them. If something is broken, send it
back to fix it or say why it's fine; if nothing is, say nothing. A module, so it can be turned off.

## Where the idea comes from

- **ripwire** ([inspiration](../inspiration/ripwire.md)): `--quality-delta` (only what got worse against a baseline),
  `--edit-check`, and `--test-gate`, run at the "I think I'm done" moment. Its field report credits that gate with a
  dozen real fixes across about 15 agents, through a "fix it or justify it in writing" rule.
- **Serena** ([inspiration](../inspiration/serena.md)): diagnostics diffed before and after an edit, but switched off
  per edit, since one edit often breaks what the next one fixes. Checking once, at the end, avoids that noise.
- **Claude Code's Stop hook**: a hook that exits with code 2 stops Claude from stopping, and its message tells Claude
  why. `agent_before_settle` is pi's version of that moment.

## Behavior

- **When:** at the end of a run in Build that finished normally (not aborted, no error), when files changed or todo
  has open tasks. In a Git repository, changed files Git ignores are left out before the 50-file limit; if Git cannot
  list ignored files, the check warns once and checks every changed file. Plan makes no edits, so it's never checked.
  A `/plan implement` run is a Build run, so it ends with the check too. The mode is plan-build's, so the check asks
  for it on the [event bus](#the-event-bus) (`mode`); with no answer (no plan-build), it counts as Build.
- **Changed files:** every file whose modification time differs from the start of the run, or that was created or
  deleted since, skipping hidden folders and `node_modules`. That catches `bash` (`sed -i`, code generators,
  `git checkout`), not only `edit`, `write`, and `lsp_edit`. Two scans per Build run: 4 ms for MyPi, 245 ms for a
  2,768-file tree (measured for lsp, 2026-10-24).
- **What it checks:** errors (not warnings or hints) in the changed files, at most 50 of them (`MAX_CHECKED_FILES`, so
  a big `git checkout` doesn't open hundreds of files in a server; the report counts the rest), from everything that
  answers `diagnostics` on the [event bus](#the-event-bus). Today that's the [LSP](lsp.md) module.
- **The project's own commands** (slice 2), such as the typecheck and the tests, listed in `.pi/done-check.json` as
  `{ "commands": ["npm run typecheck", "npm test"] }`. They run one after another in the project's folder, through
  pi's own shell (`createLocalBashOperations().exec`, as `bash` and background jobs do), at most 2 minutes each
  (`COMMAND_TIMEOUT_SECONDS`); a time-out counts as a failure. One that fails adds its exit code and the end of its
  output (2,000 characters, escape codes stripped) to the same report as the errors. Esc stops them.
- **Approved once per list, per machine:** before running a list it hasn't seen, the check asks ("Done check: run
  these after each Build run in <folder>?") and lists them. Yes is remembered in
  `~/.pi/agent/done-check/approved.json`, by repository (`git:<canonical Git common directory>`) or non-Git folder
  (`folder:<canonical cwd>`), as the exact ordered list. Linked worktrees share approval, separate clones do not;
  configuration and execution stay in the active checkout. A list that changes in any way asks again, so a `git pull`
  or the agent editing the file can't run anything unseen. Legacy cwd-only keys are not reused; this hard cutover may
  ask once again. No holds for the session. Without a UI, nothing runs and the user is warned once. A file that isn't a list of commands is a warning
  too, once per session.
- **`.pi/done-check.json` is the project's file:** MyPi doesn't touch git for it (unlike `.pi/plans/` and
  `.pi/memories/`, which `keepOutOfGit` hides), so it can be committed and shared; each machine still approves it.
- **`/done-check`** shows the list and whether it's approved on this machine.
- **A source that can't check** is told to the user, not the agent, which couldn't fix it: a source that fails is a
  warning ("Done check: lsp couldn't check: …"), and the LSP module warns once per session about a server that isn't
  installed or failed to start ("LSP: the done check skips .ts files: …"). A server turned off in `/lsp` is skipped
  quietly: that's the user's choice. Never dropped silently.
- **No baseline:** an error that was already in a file the agent touched is reported too. The report asks the agent to
  fix it or say why it's fine, so "that was already there" is a fine answer, and the loop guard stops a repeat. A real
  baseline would need diagnostics before the first edit, which means starting language servers on edit; lsp rejected
  that (it starts servers on first use).
- **The report:** one message, shown in the TUI and sent to the model, then one more model request in the same run. At
  most 20 errors are listed ("… and N more"); the next round shows the rest.

  ```
  Done check: 2 errors in files changed during this run, and 1 check command failed.
  src/store.ts:12:7  Type 'string' is not assignable to type 'number'. (ts 2322)
  src/main.ts:4:1  Cannot find name 'makeStore'. (ts 2304)
  `npm test` failed (exit 1):
      FAIL src/store.test.ts
        expected 2, got "2"
  Fix these, or say why they're fine.
  ```

- **Open tasks** (todo slice): pending and in-progress tasks are reported even when no files changed. The report
  lists each task's id, status, and subject, then asks the model to finish them or mark each completed or deleted and
  say why, and to leave them open if the user asked it to stop before them. Without that last sentence, a model told
  "do only the first, then stop" was sent back and did the second too (seen live 2026-10-26). An open-task report continues the run under the same 3-round and repeat rules; it is not a pass.
- **Nothing to report:** says nothing. The footer shows `checking…` while it runs.
- **Loop guard:** at most 3 rounds per prompt, and it stops early when a round's report is the same as the last one.
  After that it's quiet until the next prompt.
- **Esc** during the check aborts the run, as at any other point.
- **Turned off** in `/modules` (`ON_LOAD`), everything else works as before: nothing asks on the bus, and LSP's
  answer just isn't called. With the LSP module turned off, nothing answers `diagnostics`: the done check skips the errors in
  changed files and still runs the project's approved commands and the open-task check (seen live: a failed command
  was still reported, and no language server started).

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/done-check/`, `ON_LOAD` | On by default; `/modules` turns it off. |
| Run start | `before_agent_start` | Takes the snapshot of modification times, and resets the round count, in either mode: the mode is checked at the end, which also covers a switch to Plan during the run. A continuation asked for by the check stays in the same run, so it keeps both. |
| The check | `agent_before_settle`, in Build, when `outcome` is `"completed"` (`index.ts`; the report is pure, in `report.ts`) | pi awaits the handler (`_runBeforeSettleBoundary` in `dist/core/agent-session.js`), so the check runs before the run ends. It returns `{ entries: [custom_message], continue: true }` to send the report and ask for one more model request; pi's docs warn that an unconditional continuation loops, hence the guard. |
| Report | A `custom_message` entry, `customType: "mypi-done-check"`, `display: true` | In the transcript like any message; a renderer can come later. |
| Changed files | `fileTimes` and `fileChanges`, moved from `lsp/util/walk.ts` to `src/core/util/walk.ts` | Two parts need them now, so they went to core, as [principles](../principles.md) say. `fileTimes` takes every file, or the extensions lsp asks for; core has its own change kinds (`FileChangeKind`), which lsp's client maps to the protocol's. |
| Mode | `ask("mode")` on the [event bus](#the-event-bus) | plan-build answers with `"plan"` or `"build"`. |
| Diagnostics | `ask("diagnostics", { files, signal })` on the event bus | The LSP module answers in `init()` (`problems.ts`), for each file a server serves, through the same `fileProblems` as its `diagnostics` action; each server is brought up to date with the disk once first. Files no server serves are skipped; a server not yet running starts then, as on any first use. See [lsp](lsp.md#design-in-pi). |
| Open tasks | `ask("openTasks", undefined)` on the event bus | Todo answers with pending and in-progress tasks; no answer means todo is off. Open tasks are reported even with no changed files. |
| Commands | `project-commands.ts`: `readCommands`, `approvalKey`, `isApproved`, `approve`, `runCommand` | The list is validated at the boundary (`{ "commands": string[] }`, else an error saying so); approvals in pi's agent dir (`getAgentDir()`), never the project. |
| Approval | `ctx.ui.select` with Yes and No, in `approvedCommands` (`index.ts`) | Like the tool guard's dialog. |
| `/done-check` | `commands/done-check.ts` | Shows the list and its approval. |
| Footer | `BaseModule.setFooter` | `checking…` while it runs. |

### The event bus

The done check needs things other modules own: the mode (plan-build) and the problems in files (LSP). It can't import
them ([Modular](../principles.md#modular): parts talk through seams), and a new service on `Session` for each such
need would grow `Session` with every one. So MyPi gets one in-memory event bus, on top of the one pi already gives every
extension: `pi.events`, with `emit(channel, data)` and `on(channel, handler)` (pi's `docs/extensions.md`: "Communicate
with another extension").

**What pi's bus is** (read in pi 1.2.0's `dist/core/event-bus.js` and `extensions/loader.js`):

- A Node `EventEmitter`, shared by every extension in the process, so MyPi's channels go out as `mypi:<channel>`.
- pi drops every listener an extension added when its runtime goes away (`/reload`, a session switch), so handlers
  never stack.
- A handler that throws is caught and logged to the console, so a listener can't break whoever published.
- `emit` returns nothing: there's no answer back.

**MyPi's helpers**, in `src/core/events.ts`, over `pi.events`:

- `publish(channel, data)` and `subscribe(channel, handler)` for notices ("something happened").
- `ask(channel, request)` and `answer(channel, handler)` for questions every listener answers. The request goes out
  with an empty list of answers; each answering listener adds its answer (a promise) to it. Node's `emit` calls every
  listener before it returns, so once it returns, `ask` waits on the whole list and knows exactly who answered, with
  no registry. A test pins that `emit` calls listeners at once, so a pi upgrade that changes it fails loudly.
- `ask` gives back each answer, and each failure with its source's name (`Answer`: `answer` or `failed`), for the
  asker to report.
- Two channel maps type them all, in `src/core/channels.ts` (the contracts, apart from the mechanism in `events.ts`):
  `MyPiNotices` and `MyPiQuestions`, each channel with what it carries and a comment naming who publishes or asks and
  who listens or answers. Publishing and listening are type-checked, every channel is listed in one place, and
  removing one makes the typecheck list the code it leaves behind.

  ```ts
  export type MyPiNotices = {
    /** How many jobs are running. `JobManager` publishes; `Session`'s footer item listens (later the fleet view). */
    jobs: number;
  };

  export type OpenTask = { id: string; subject: string; status: "pending" | "in_progress" };

  export type MyPiQuestions = {
    /** Plan or Build. The done check asks; plan-build answers. */
    mode: { request: undefined; answer: "plan" | "build" };
    /** The problems in `files`. The done check asks; the LSP module answers. */
    diagnostics: { request: { files: readonly string[]; signal?: AbortSignal }; answer: Problem[] };
    /** Tasks still open at the end of a Build run. The done check asks; todo answers. */
    openTasks: { request: undefined; answer: OpenTask[] };
  };
  ```

- Modules use them through `BaseModule` (`this.publish`, `this.subscribe`, `this.ask`, `this.answer`); core uses the
  functions with `session.pi.events`. `Session` doesn't grow.

**Its channels:**

| Channel | Kind | Publishes or asks | Listens or answers |
|---|---|---|---|
| `jobs` | notice: how many jobs are running | `JobManager` | `Session`'s footer item; later the subagents fleet view |
| `mode` | ask | done check | plan-build |
| `diagnostics` | ask | done check | LSP |
| `openTasks` | ask | done check | todo |

- **`jobs` moved over from `JobManager.onChange`**, its own listener list, which is gone. `stopAll` stops publishing
  before the jobs end, as `onChange` dropped its listeners first: a job ending after the session has would otherwise
  reach a stale context.
- **What stays a service:** the tool rules, prompt sections, footer items, editor keys, the writable list, and the
  module, tool, and command lists. Core combines those by a fixed rule at a fixed moment, without waiting (any block
  wins; sections are written on every run; writable folders are merged on every tool call), and a tool call can't
  wait on an `ask`. The bus is for messages between parts that don't need that.

## Slices

1. **Done 2026-10-24.** The event bus (`src/core/events.ts`, the `BaseModule` helpers, the channel maps) with its
   channels: `jobs` moved over from `JobManager.onChange`, `mode` answered by plan-build, and
   `diagnostics` answered by LSP. Then the done check itself: the changed-files snapshot (the walk helpers moved to
   core), the `agent_before_settle` report, the loop guard, and the footer. Tried live in pi with TypeScript, Go, and
   Python files holding type errors: one report listed all three servers' errors; told the errors were real, pi fixed
   them and the next check was quiet; told to keep them, pi said why and the repeat stopped the loop; an error already
   in an edited file was reported and pi called it pre-existing; a file written from outside during a Build run was
   caught, and during a Plan run wasn't; the footer's job count still shows over the bus.
2. **Done 2026-10-24.** The project's own commands, such as the typecheck and the tests:
   - Listed in `.pi/done-check.json` (`{ "commands": ["npm run typecheck"] }`), written by the user or by the agent
     when asked.
   - **Approved once:** the first time a project's list is seen, and whenever it changes, the done check asks before
     running it ("Run these after each turn?"), and remembers the approved list per project in its own global folder.
     A command that runs on its own after every turn is code a cloned repo could choose, the same worry as lsp's
     `node_modules/.bin` question.
   - Each command runs with a time limit; a failure sends the end of its output, cut to fit.
   - A `/done-check` command shows the list and whether it's approved.

   Tried live in pi with a `node --test` list: `/done-check` said not approved; the first check asked, Yes ran the
   test and sent back its failure with the end of the output; a changed list asked again; with a fixed function the
   passing test kept the check quiet; a function broken from outside during a run came back as a failed assertion;
   after No, nothing ran and the next run didn't ask. With the LSP module turned off in `/modules`, the report held
   only the failed command, a TypeScript error went unchecked, and no language server started.
3. Moved to [analytics](analytics.md#what-to-measure) (2026-10-24): counting how often the check caught
   something, to show whether it pays. The done check would publish a notice on the bus for each report, and
   analytics would listen; the channel comes with analytics, its first listener.
4. **Built 2026-10-26 (roadmap "Self-build fixes").** Say when it passed. A clean check appends one short line naming
   each diagnostics source that answered, with how many changed files it checked, and each approved command that ran
   (`Done check passed: lsp checked 1 changed file; true passed.`); if nothing ran, it stays quiet. The line
   lands after the model's last message, so the model sees it on its next turn, not in the run it ends.
5. **Done 2026-10-26, with [todo](todo.md) slice 4.** Open tasks: when a Build run ends with todo tasks still
   `pending` or `in_progress`, the report lists them and the run continues, as for a failed command, even when no files
   changed, unless the user asked to stop before them. The done check asks todo on the event bus (`openTasks`). With
   todo off, no one answers and behavior is unchanged. Aimed at milestone 1's main failure: stopping partway.

6. **Done 2026-10-26: skip Git-ignored changes.** `git ls-files -z --others --ignored --exclude-standard --directory`
   lists ignored untracked files and whole ignored folders once, before the done check's 50-file limit. This avoids
   handing the 50 generated `coverage/` files rewritten by `npm run check` to LSP. It runs only in a Git project and
   only when files changed; if Git fails, the check warns once and checks all changes. The shared `fileTimes` walk
   stays unchanged for LSP.

## Decided 2026-10-24

- Changed files come from modification times at the start and end of the run, so changes made through `bash` count.
- All errors in changed files are reported, with no baseline; warnings and hints aren't.
- At most 3 rounds per prompt, fewer when the same report comes back.
- `ON_LOAD`, and turning it off leaves everything else working.
- Commands live in `.pi/done-check.json` and run only after the user approves the list, again when it changes.
- The check runs in `agent_before_settle` and continues the same run, not as a follow-up message that starts a new
  one (my call; the follow-up was the idea doc's plan).
- LSP diagnostics come first (slice 1) and commands second: diagnostics need no setup and run no project code.
- Parts reach each other's information through one in-memory event bus over pi's `pi.events`, not a new service on
  `Session` per need (the user's call, so `Session` stops growing). Notices and asks; the existing services stay.
- The report says "files changed during this run", not "files you changed": a file changed by something else during
  the run (an editor, a build) is checked too, and in the live test pi rightly said it hadn't touched it.
- Slice 2 (the user took all five suggestions): approvals in `~/.pi/agent/done-check/approved.json`, originally by
  project folder; worktree slice 3 (2026-10-25) keys Git repositories by canonical common directory, non-Git folders
  by canonical cwd, with no reuse of legacy keys; one report for errors and failed commands; 2 minutes per command, fixed; without a UI, nothing runs and the
  user is warned once; commands run one at a time through pi's own shell. `.pi/done-check.json` is left to git like
  any project file.
- Built with slice 1 (my calls, easy to change): a source that can't check is a warning to the user, not a line in
  the agent's report, since the agent can't fix a crashed or missing server; at most 50 files checked and 20 errors
  listed per round; the mode is checked only at the end of the run.

## Open questions

- How long may one round take before it gives up on a slow source? Pyright's pushed diagnostics already wait up to
  10 s per file.
- Should the report go to the model only, with the TUI showing a one-line summary, once a renderer exists?

## References

- ripwire: README § "Better Code", the field report, `--quality-delta` in `docs/COMMANDS.md`
- Serena: `EditingToolWithDiagnostics` in `src/serena/tools/tools_base.py`
- pi: `agent_before_settle` in `docs/extensions.md` (§ events) and `AgentBeforeSettleEvent` in
  `dist/core/extensions/types.d.ts`; `pi.events` in `docs/extensions.md` and `dist/core/event-bus.js`
- Claude Code: Stop hooks in the hooks reference
