# todo

**Status:** building (2026-10-26): the four task tools, branch-following state, and UI are built; the reminder and
plan seeding with open tasks in the done check come next.

## Goal

A checklist the agent keeps while it works: it writes the steps, marks one in progress, and ticks them off. The user
sees the list and can follow the work or spot a wrong turn early.

Why now (2026-10-26): in subagents milestone 1, pi on gpt-6-luna stopped partway in 4 of 5 checkpoints. The
deliverables sat in a 200-line plan it read once at the start. A list seeded from the plan, kept in view, and checked
by the done check turns "stopped early" from a review finding into something MyPi catches in the session. It won't
fix self-reports; see [what it doesn't solve](#what-it-doesnt-solve).

Pi 1.2.0 has no todo tool, only an example.

## How Claude Code does it

The user's view: it works really well, and the UI is clear. The feature has four tools, one task at a time:

- `task_create { subject, description, activeForm? }`: imperative subject ("Run tests"); optional present-continuous
  `activeForm` ("Running tests") appears beside the spinner while the task is in progress.
- `task_update { taskId, status?, subject?, description?, activeForm? }`: updates one task. Statuses are `pending`,
  `in_progress`, `completed`, or `deleted`; deleted removes it.
- `task_list`: each task's id, subject, and status.
- `task_get { taskId }`: one task in full, including its description.

The descriptions tell the model to use tasks for work with 3 or more steps, several user tasks, and after new
instructions, but not for one simple task. A task is `in_progress` before work starts and `completed` as soon as it is
done. Never mark it completed if tests fail, work is partial, or errors are unresolved. When blocked, keep it
`in_progress` and create a task for what blocks it; add follow-ups found along the way.

The widget (`mypi-todo`) draws the list above the editor in id order, every task when five fit. In-progress
tasks use the accent color, pending tasks are muted, and completed tasks are dimmed and struck through when the theme
supports it.
With more than five, it keeps four rows (in progress first, then pending, then the latest completed) and a last line
counting the rest and how many of those are completed. The in-progress task's `activeForm` (or its subject) appears beside pi's spinner. `alt+t` hides or shows the
widget for this session; it does not change the task list.

When tools have not been used for five assistant messages, a transient reminder is added to the next request with the
current list.

## Decisions (2026-10-26)

- This is an `ON_LOAD` module, not a built-in tool: it owns the prompt, context handler, and UI, and can be turned off
  in `/modules`. Its own context handler keeps the module independently removable.
- State is the full task list in each tool result's `details`, rebuilt from the last task result on the active branch
  at startup and on `session_tree`. No external file. When a run starts with every task completed, the list
  starts over (ids from 1); the finished list stays in view until then. Not when a task is created: the model often
  creates one task, finishes it, then creates the next (seen live 2026-10-26), and that wiped the list.
- The tools are named `task_create`, `task_update`, `task_list`, and `task_get`; "task" does not conflict with MyPi's
  background "jobs".
- `readOnlyHint: true` is accurate: these tools change only session context and are available in Plan.
- The toggle is `alt+t`; pi uses `ctrl+t` for thinking blocks.
- The reminder comes every five quiet assistant messages since the last task tool call (or session start).
- Plan seeding belongs to todo's own prompt section, not plan-build's Build prompt. Disabling todo removes its tools,
  reminder, prompt section, widget, and open-task answer together.
- No `owner`, `blocks`, or `metadata` until there is a need for subagents to share and claim tasks.

## Implementation

| Part | Location | Behavior |
|---|---|---|
| Tools and state | `src/module/todo/tasks.ts`, `tools.ts` | Pure list rules; each result stores the complete list in `details`. |
| Module | `src/module/todo/index.ts` | Restores state and registers the module's hooks, prompt, and tools. |
| UI | `src/module/todo/widget.ts` | Pure widget lines; the module updates the widget and working message. |
| Reminder | `context` handler | Adds a transient reminder and task list to the next model request. |
| Plan seeding | todo prompt section | Starts tasks from each deliverable in the step being done, including tests and live check. |
| Done check | `openTasks` event-bus question | Reports pending and in-progress tasks at the end of a Build run. |

## What it doesn't solve

Milestone 1 also found wrong self-reports (a reuse claim, "the done check didn't run"), rules without failing tests,
repeat mistakes (an undeclared import), and pi not running interactive live checks. Those have separate fixes in the
roadmap.

## Sources

- Claude Code: [tools reference, Task tool availability](https://code.claude.com/docs/en/tools-reference#task-tool-availability),
  [interactive mode, task list](https://code.claude.com/docs/en/interactive-mode#task-list),
  [Agent SDK, track todos](https://code.claude.com/docs/en/agent-sdk/todo-tracking).
- Pi: `examples/extensions/todo.ts`, `docs/extensions.md` (state in tool result details), and
  `setWidget` / `setWorkingMessage` in `dist/core/extensions/types.d.ts`.
