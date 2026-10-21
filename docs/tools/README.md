# Tools

MyPi's built-in tools: the most important general tools, the ones that don't belong to any module. They're part of
the core of MyPi, not modules, so they're there whatever modules are loaded. A module can still add its own tools
(`src/module/<name>/tools/`, returned from its `tools()`); those are documented in the module's doc.

Each built-in tool has a doc here, named after the tool with `-` for `_` (`web_search` → `web-search.md`). Statuses
are the same as for modules:

| Status | Meaning |
|---|---|
| `idea` | Worth exploring, not designed yet |
| `planned` | Design agreed, not started |
| `building` | In progress |
| `done` | Built and in use |

## Rules for every built-in tool

- Works with every model. Nothing provider-native, and no service that belongs to a model provider.
- No paid key required. A key may raise a service's limits, but the tool works without one.
- Sets `annotations` truthfully (`readOnlyHint`, `destructiveHint`, `openWorldHint`), because the tool guard and
  plan-build's rule read them.

## Index

The must-haves:

| Tool | Status | Summary |
|---|---|---|
| [web_search](web-search.md) | building | Search the web through keyless search services; returns titles, URLs, and excerpts |
| [web_fetch](web-fetch.md) | building | Fetch a URL and return readable markdown, capped |
| [todo](todo.md) | idea | A checklist the agent keeps while it works, shown to the user |
| [background process](background-process.md) | idea | Start long-running commands, read their output, stop them, and get told when they exit; monitor output |
| [apply_patch](apply-patch.md) | idea | Multi-file edits in Codex's patch format |
| [worktree](worktree.md) | idea | Optionally work in a git worktree: create, enter, exit, remove |

Tools that are modules instead, so they can be turned off, are documented in `docs/modules/`: `subagent`
([subagents](../modules/subagents.md)), [LSP](../modules/lsp.md), and desktop
[notifications](../modules/notifications.md).

## Deferred

Anything that needs an MCP server or other third-party tooling waits until MyPi has MCP support. The plan: one shared
MCP endpoint, with MCP servers added to it the way modules are added. Deferred until then:

| Tool | Who has it | Needs |
|---|---|---|
| code_search | OpenCode `codesearch` (Exa `get_code_context_exa`) | Exa's MCP server |
| MCP resources (list, read) | Claude Code, OpenCode | MCP support |

## Where the code goes

Built (2026-10-21), the same way as `src/command/`:

- One file per tool, `src/tool/<name>.ts`, or a folder, `src/tool/<name>/index.ts`, once it needs more than one file.
  It exports a function that takes the `Session` and returns a `Tool` (`src/tool/types.ts`): `{ definition, init?,
  shutdown? }`, with `definition` built by `defineTool({ … })`.
- `init()` runs on `session_start` once every tool is registered; `shutdown()` runs on `session_shutdown` and must be
  idempotent. Only tools that keep state or resources need them (todo, background process).
- `createTools(session)` in `src/tool/index.ts` lists them. `registerTools(pi, session)` registers that list, then the
  running modules' `tools()`.
- `MyPi.onSessionStart` calls `registerTools` on every `session_start`, after the modules are picked and before their
  `init()`, since a module's `init()` may turn its tools on and pi ignores names that aren't registered yet.
- Imported as `#tool/<file>`; tests in `test/tool/`, mirroring `src/tool/`.

See [Tools](../architecture.md#tools) in the architecture doc for why each tool is wrapped in `defineTool`.
