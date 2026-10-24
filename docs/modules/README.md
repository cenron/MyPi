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
| [analytics](analytics.md) | idea | Metrics across sessions and pi instances, per model and effort: tokens, cache, tool failures, shell commands without a tool; later, benchmarks for new models. SQLite under `~/.pi/` |
| [done-check](done-check.md) | idea | When the agent says it's done, run the typecheck and nearby tests, report only what got worse, and send it back |
| [lsp](lsp.md) | building | Symbol navigation, rename, and diagnostics from language servers, with a `/lsp` menu |
| [memory](memory.md) | done | Markdown memories per project (git-ignored) and global; the prompt lists them, the agent reads what it needs. `ALWAYS`, replaceable |
| [notifications](notifications.md) | idea | A desktop notification when the agent is done or a dialog is waiting |
| [pair-programmer](pair-programmer.md) | idea | A pair-programming mode where the agent navigates and I drive |
| [plan-build](plan-build.md) | done | Plan and Build modes with an "Implement this plan?" dialog |
| [subagents](subagents.md) | planned | Reusable agents (architect, developer, reviewer, and ones I create) run as pi sessions through pi's SDK, with a fleet view; external harnesses in herdr panes later. `ON_LOAD`, can be turned off |

Built-in tools that don't belong to a module are documented in [`docs/tools/`](../tools/README.md).

What to build next, in order: [roadmap](../roadmap.md).
