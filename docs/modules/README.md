# Modules

Each module has a doc here, named after its folder in `src/module/`. Start a doc when the idea comes up, and update its status as it moves along.

| Status | Meaning |
|---|---|
| `idea` | Worth exploring, not designed yet |
| `planned` | Design agreed, not started |
| `building` | In progress |
| `done` | Built and in use |

## Index

| Module | Status | Summary |
|---|---|---|
| [analytics](analytics.md) | done | Local metrics from session files, per model and effort: tokens, cost, cache, tool failures, shell commands without a tool, code navigation, MyPi's features, permission dialogs; `/analytics` and the `analytics` tool. SQLite under pi's agent dir. `ON_LOAD` |
| [context](context.md) | building | What goes to the model as a session grows: compaction summaries that keep decisions, the plan, and the next step, and clearing old tool results. `ON_LOAD` |
| [done-check](done-check.md) | done | When the agent is about to stop, check the files it changed (LSP errors) and run the project's approved commands, and send it back to fix what's broken |
| [lsp](lsp.md) | done | Symbol navigation, rename, and diagnostics from language servers, with a `/lsp` menu |
| [memory](memory.md) | done | Markdown memories per project (git-ignored) and global; the prompt lists them, the agent reads what it needs. `ALWAYS`, replaceable |
| [notifications](notifications.md) | idea | A desktop notification when the agent is done or a dialog is waiting |
| [pair-programmer](pair-programmer.md) | idea | A pair-programming mode where the agent navigates and I drive |
| [plan-build](plan-build.md) | done | Plan and Build modes with an "Implement this plan?" dialog |
| [quiet](quiet.md) | done | Compact tool-call status lines with failures open and a `QUIET` footer label. `ALWAYS` |
| [subagents](subagents.md) | done | Reusable agents (architect, developer, reviewer, and ones I create) run as pi sessions through pi's SDK, with the jobs and agents views and parallel worktree writers returning patches; external harnesses in herdr panes later. `ALWAYS`: foundational, for background research and checks as well as delegated work |
| [todo](todo.md) | done | Claude Code-style task tools, branch-following checklist, UI, reminder, plan seeding, and open-task reporting. `ON_LOAD` |

Built-in tools that don't belong to a module are documented in [`docs/tools/`](../tools/README.md).

What to build next, in order: [roadmap](../roadmap.md).
