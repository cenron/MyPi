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
| [lm-studio](lm-studio.md) | idea | LM Studio as a provider, with models read live from a local or remote server |
| [lsp](lsp.md) | idea | Language-server diagnostics after edits, plus definition, references, and hover |
| [notifications](notifications.md) | idea | A desktop notification when the agent is done or a dialog is waiting |
| [pair-programmer](pair-programmer.md) | idea | A pair-programming mode where the agent navigates and I drive |
| [plan-build](plan-build.md) | done | Plan and Build modes with an "Implement this plan?" dialog |
| [subagents](subagents.md) | idea (deferred) | A `subagent` tool on pi-durable: a task in its own context that survives restarts. `ON_LOAD`, can be turned off |

Built-in tools that don't belong to a module are documented in [`docs/tools/`](../tools/README.md).
