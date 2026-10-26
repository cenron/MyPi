# todo

**Status:** planned, next on the roadmap (2026-10-26): before subagents milestone 2, which will test it.

## Goal

A checklist the agent keeps while it works: it writes the steps, marks one in progress, and ticks them off. The user
sees the list, so they can follow the work and spot a wrong turn early.

Why now (2026-10-26): in subagents milestone 1, pi on gpt-6-luna **stopped partway in 4 of 5 checkpoints** on medium
thinking (the milestone plan's Observations log; the session review in `.pi/plans/`, git-ignored). The deliverables sat
in a 200-line plan it read once at the start. A list seeded from the plan, kept in view, and checked by the done check
turns "stopped early" from a review finding into something MyPi catches in the session. It won't fix self-reports (a
ticked box is still the model's claim); see "What it doesn't solve".

Pi 1.2.0 has no todo tool, only an example.

## How Claude Code does it (checked 2026-10-26, and seen first-hand in a Claude Code session)

The user's view: it works really well, and the UI is very clear. What it is:

- **Four tools, one task at a time** (the default since v2.1.268; the older whole-list `TodoWrite` is behind
  `CLAUDE_CODE_ENABLE_TASKS=0`):
  - `TaskCreate { subject, description, activeForm? }`. `subject` is imperative ("Run tests"); `activeForm` is
    present continuous ("Running tests") and is shown beside the spinner while the task is in progress. The result
    carries the new task's id.
  - `TaskUpdate { taskId, status?, subject?, description?, activeForm?, owner?, addBlocks?, addBlockedBy?,
    metadata? }`. Statuses: `pending` → `in_progress` → `completed`, or `deleted` to remove one.
  - `TaskList`: each task's id, subject, status, owner, and open `blockedBy`. Prefer the lowest id when several are
    free.
  - `TaskGet { taskId }`: one task in full, with its description.
- **The tool descriptions carry the rules**, and they're what make it work:
  - Use it for work of 3 or more distinct steps, when the user gives several tasks, and right after new
    instructions. Skip it for one simple task.
  - Mark a task `in_progress` **before** starting it, and `completed` as soon as it's done.
  - **Never mark a task completed if tests fail, the work is partial, or errors are unresolved.** When blocked, keep
    it `in_progress` and create a new task for what blocks it.
  - Add follow-up tasks found along the way.
- **Reminders keep the list in view.** When the tools haven't been used for a while, Claude Code adds a system
  reminder to the next request: "The task tools haven't been used recently. If you're working on tasks that would
  benefit from tracking progress, consider using TaskCreate…", followed by **the current list with each task's id,
  subject, and status**. It's transient, not part of the transcript. This is why the list survives long sessions and
  compaction: it's re-sent, not remembered.
- **The UI:** the list shows above the input with a status mark per task (pending, in progress, done), at most five at
  a time; the in-progress task's `activeForm` shows beside the spinner; Ctrl+T toggles the list. It's separate from
  the background-task view (`/tasks`, for shells and subagents).
- **Persistence:** tasks persist across compaction; `CLAUDE_CODE_TASK_LIST_ID` shares one list across sessions as files
  in `~/.claude/tasks/`. `owner` and `blockedBy` let agents in a team share and claim tasks.
- **Which models get it:** by default only Opus 4.7, Sonnet 4.6, Haiku 4.5 and older; newer models track multi-step
  work without a written list, and the tools and reminders cost context. Opt in with
  `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.

Sources: [tools reference § Task tool availability](https://code.claude.com/docs/en/tools-reference#task-tool-availability),
[interactive mode § Task list](https://code.claude.com/docs/en/interactive-mode#task-list),
[Agent SDK: track todos](https://code.claude.com/docs/en/agent-sdk/todo-tracking).

## Other harnesses

| Harness | Tool | Shape |
|---|---|---|
| OpenCode | `todowrite` (behind `experimental.todo`) | `{ todos: [{ content, status }] }`, the whole list every call. Status is `pending`, `in_progress`, `completed`, or `cancelled`. Result text is a one-line summary (`Todos updated: 2/5 completed, 1 in progress. In progress: "Write tests"`). |
| Codex CLI | `update_plan` | `{ explanation?, plan: [{ step, status }] }`, the whole list every call. |
| pi | `examples/extensions/todo.ts` | `list`/`add`/`toggle`/`clear` and a `/todos` command; state in each result's `details`, so it follows branching. |

## Decided (2026-10-26)

- **Follow Claude Code's current shape, not whole-list replace** (the user: "it works really well"): one task at a
  time, with ids, `subject`, `activeForm`, and the four statuses. An update re-sends one task, not the list. `owner`
  and `blockedBy` wait for a need (subagents sharing a list, milestone 2 or later).
- **Copy the rules into the tool descriptions** nearly word for word, above all "never mark completed if tests fail or
  the work is partial".
- **Copy the reminder:** MyPi's `context` handler (the one that clears old tool results) adds a transient reminder with
  the open list when the tools haven't been used for a few turns. Nothing is saved to the session.
- **Copy the UI** (the user likes it): a widget above the editor (`ctx.ui.setWidget(…, { placement: "aboveEditor" })`)
  with a mark per task, at most five, and the in-progress task's `activeForm` as pi's working message
  (`ctx.ui.setWorkingMessage`). pi already uses Ctrl+T (thinking blocks), so the toggle needs another key.
- **Seed it from the plan.** When Build starts on a plan (`/plan implement`, or the dialog's Implement), Build's prompt
  tells the model to create its tasks first from the plan's next unticked step, one task per deliverable, including
  the live check. The model writes the list; MyPi parses nothing.
- **The done check reports open tasks.** When a Build run ends with tasks still `pending` or `in_progress`, the done
  check's report lists them ("3 tasks still open: …") and the run continues, like a failed command. It asks the todo
  tool on the event bus, not its state.
- **On for every model at first.** Luna is the case where a list still pays; subagents milestone 2 measures whether it
  helps (see the roadmap). Revisit per-model after that.
- **State lives in the tool results' `details`** and is rebuilt from the branch on `session_start` and
  `session_tree`, as pi's example does, so it follows branching and `/tree`. Allowed in Plan (`readOnlyHint`): it
  changes no files.

## What it doesn't solve

Measured in milestone 1: wrong self-reports (a reuse claim, "the done check didn't run"), rules without failing tests,
repeat mistakes (an undeclared import), and pi not running interactive live checks. Those have their own fixes in the
roadmap row before this one ("Self-build fixes").

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tools | A folder, `src/tool/todo/`, listed in `createTools` | `task_create`, `task_update`, `task_list` (and `task_get` if descriptions get long). TypeBox `parameters`; each result's `details` holds the whole list. |
| State | Rebuilt from the branch: the last task result's `details` | On `session_start` and on `session_tree` through `session.pi.on` in `init()`, like pi's example. No file. |
| Reminder | `context` event | A transient message at the end with the open tasks, when none of the task tools ran in the last few assistant turns. |
| Display | `ctx.ui.setWidget` above the editor; `ctx.ui.setWorkingMessage` | Marks per status, at most five; the in-progress `activeForm` beside the spinner. |
| Plan seeding | plan-build's `buildPrompt(plan)` | One line: create tasks from the plan's next step before starting. |
| Done check | An `open-tasks` question on the event bus | Answered by the todo tool; open tasks go in the report. |
| Plan mode | `readOnlyHint: true` | It touches no files. |

## Slices

1. The tools (`task_create`, `task_update`, `task_list`) with Claude Code's rules in their descriptions, state in
   `details`, rebuilt from the branch.
2. The UI: the widget above the editor and the working message.
3. The reminder in the `context` handler.
4. Plan seeding (plan-build's Build prompt) and open tasks in the done check's report.

Each slice gets a [live check](../../AGENTS.md#live-checks) in an interactive pi (in a herdr pane).

## Open questions

- Names: `task_create`/`task_update`/`task_list`, or `todo_*`? (`task` may read like background jobs; Claude Code keeps
  the two apart in the UI.)
- The toggle key, since Ctrl+T is pi's.
- How many quiet turns before the reminder (Claude Code doesn't publish its count).
- `task_get` and `description`: needed, or is `subject` enough?

## References

- Claude Code: the three pages under "How Claude Code does it".
- pi: `examples/extensions/todo.ts`, `docs/extensions.md` (state in tool result details), `setWidget`,
  `setWorkingMessage` in `dist/core/extensions/types.d.ts`.
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/todo.ts`, `packages/core/src/tool/todowrite.txt`
- Codex (`openai/codex`, `main`): `codex-rs/core/src/tools/handlers/plan_spec.rs`
