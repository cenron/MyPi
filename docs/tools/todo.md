# todo

**Status:** idea

## Goal

A checklist the agent keeps while it works: it writes the steps, marks one in progress, and ticks them off. The user
sees the list, so they can follow the work and spot a wrong turn early. Pi 1.2.0 has no todo tool, only an example.

## What pi offers

- **`examples/extensions/todo.ts`**: a `todo` tool with `list`/`add`/`toggle`/`clear` actions and a `/todos`
  command. Its state lives in each tool result's `details`, not in a file, so it follows branching: after `/tree` or a
  fork, the list is whatever it was at that point. That's the pattern to copy.
- **pi package `@touchtechclub/pi-oc-todo`**: an OpenCode-style `todowrite` for pi. Useful to read.

## Other harnesses

| Harness | Tool | Shape |
|---|---|---|
| OpenCode | `todowrite` (behind `experimental.todo`) | `{ todos: [{ content, status }] }`, the whole list every call. Status is `pending`, `in_progress`, `completed`, or `cancelled`. |
| Codex CLI | `update_plan` | `{ explanation?, plan: [{ step, status }] }`, the whole list every call. Status is `pending`, `in_progress`, or `completed`. |
| Claude Code | `TodoWrite`, or `TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate` | Whole-list replace (`TodoWrite`), or one task at a time with IDs and dependencies (`Task*`). |

Details worth copying:

- **Whole-list replace** (OpenCode and Codex). Simpler for the model than add/toggle by ID, and the result is always
  the full list.
- **OpenCode's description**: use it for 3 or more steps, or several tasks from the user; skip it for one simple task;
  mark `in_progress` when starting and `completed` as soon as it's done; only call it when the list changes.
- **OpenCode's result text** is a one-line summary, not the list: `Todos updated: 2/5 completed, 1 in progress. In
  progress: "Write tests"`. The list itself goes in metadata for the UI.
- **Claude Code leaves these tools out on newer models** (v2.1.268+): newer models track multi-step work without a
  written list, and the tool definitions and reminders cost context. Opt in with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`.

## Behavior

- One tool, whole-list replace: `{ todos: [{ content, status }] }`.
- The result is a one-line summary; the list shows in the TUI.
- The list follows branching, like pi's example.
- Allowed in Plan mode: it changes no files.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tool | A folder, `src/tool/todo/`, listed in `createTools` | TypeBox `parameters`. Result `details` holds the full list. |
| State | Rebuilt from the branch in the tool's `init()` (on `session_start`), and again on `session_tree` through `session.pi.on` subscribed in `init()`: the last `todo` result's `details` | Same as pi's example. No file, nothing to clean up. |
| Display | A widget above the editor (`ctx.ui.setWidget`) or a footer item | Shows the in-progress item and the count; open question. |
| Plan mode | `readOnlyHint: true`, or add `todo` to plan-build's `ALLOWED` set | It touches no files, but it does change session state. |
| Rendering | `renderCall` / `renderResult` | The list with status marks, collapsed to the summary line. |

## Slices

1. The tool with whole-list replace, the summary result, and `details`.
2. Rebuild the list from the branch on `session_start`.
3. Display (widget or footer).
4. Rendering.

## Open questions

- Name: `todo`, `todowrite`, or `update_plan`?
- Statuses: include `cancelled` (OpenCode) or not (Codex)?
- Display: a widget above the editor, or a footer item?
- On for every model, or opt-in, given Claude Code's finding that newer models don't need it?
- Should plan-build's "Implement this plan?" seed the todo list from the plan's steps?

## References

- pi: `examples/extensions/todo.ts`, `docs/extensions.md` (state in tool result details)
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/todo.ts`, `packages/core/src/tool/todowrite.txt`
- Codex (`openai/codex`, `main`): `codex-rs/core/src/tools/handlers/plan_spec.rs`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § Task tool availability
