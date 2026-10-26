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
- Its output is honest about its limits (from [ripwire](../inspiration/ripwire.md)):
  - A cut result says what was cut and how to get the rest, such as the file holding the full text (web_fetch and
    background jobs do this).
  - Nothing found reads as "none found", never "none exist".
  - Every count says what it counts.
  - A partial list never reads as complete.
- One call should answer the question: enough to act on without a follow-up call. Short output that forces three
  more calls costs more than a longer answer.
- Every tool's schema rides in every request, so a narrow helper may be better as a skill over a shell command than as
  a tool.

## Index

The must-haves:

| Tool | Status | Summary |
|---|---|---|
| [web_search](web-search.md) | done | Search the web through keyless search services; returns titles, URLs, and excerpts |
| [web_fetch](web-fetch.md) | done | Fetch a public URL and return readable markdown, capped, with the full text saved when cut |
| [todo](todo.md) | planned (next after the self-build fixes) | Claude Code-style task tools: a checklist the agent keeps while it works, shown above the editor, seeded from the plan, checked by the done check |
| [background process](background-process.md) | done | Start long-running commands, read their output, stop them, and get told when they exit; monitor output |
| [apply_patch](apply-patch.md) | idea | Multi-file edits in Codex's patch format |
| [worktree](worktree.md) | done | `/worktree` enter, exit, list, remove: a conversation moves into a git worktree and back; memories and plans stay shared with the main checkout. No model-facing tools; subagents use `Session.worktrees`. |

Tools that are modules instead, so they can be turned off, are documented in `docs/modules/`: `subagent`
([subagents](../modules/subagents.md)), [LSP](../modules/lsp.md), and desktop
[notifications](../modules/notifications.md).

## Deferred

Tools that come from an MCP server go through MyPi's [MCP server list](../mcp/README.md): MyPi registers the server
with pi, and pi's own MCP client connects it. The MCP resource tools (list, read) come with pi's client already.
Deferred:

| Tool | Who has it | Needs |
|---|---|---|
| code_search | OpenCode `codesearch` (Exa `get_code_context_exa`) | Exa's keyless server offers only `web_search_exa` and `web_fetch_exa` (2026-10-22) |

## Where the code goes

Built (2026-10-21), the same way as `src/command/`:

- One file per tool, `src/tool/<name>.ts`, or a folder, `src/tool/<name>/index.ts`, once it needs more than one file.
  It exports a function that takes the `Session` and returns a `Tool` (`src/tool/types.ts`): `{ definition, init?,
  shutdown? }`, with `definition` built by `defineTool({ … })`.
- `init()` runs on `session_start` once every tool is registered; `shutdown()` runs on `session_shutdown` and must be
  idempotent. Only tools that keep state or resources need them: web_fetch closes its connection pool in
  `shutdown()`, and todo will use both. Background process keeps its jobs in core instead (`session.jobs`), since
  subagents will share them, and `MyPi.onSessionEnd` stops them.
- `createTools(session)` in `src/tool/index.ts` lists them. `registerTools(pi, session)` registers that list, then the
  running modules' `tools()`.
- `MyPi.onSessionStart` calls `registerTools` on every `session_start`, after the modules are picked and before their
  `init()`, since a module's `init()` may turn its tools on and pi ignores names that aren't registered yet.
- Imported as `#tool/<file>`; tests in `test/tool/`, mirroring `src/tool/`.
- Helpers more than one tool uses go in `src/tool/utils.ts` (`#tool/utils`), not new files: `callMcpTool` calls one of
  MyPi's MCP servers through `ctx.executeTool` and returns the whole MCP result, `textOf` joins a result's text parts,
  and, for renderers, `expandKey` names the expand key and `siteOf` gives a URL's site.

See [Tools](../architecture.md#tools) in the architecture doc for why each tool is wrapped in `defineTool`.
