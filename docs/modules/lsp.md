# LSP

**Status:** idea

## Goal

Code intelligence from language servers: find code by symbol instead of by text, see a file's outline without
reading it, follow references and implementations, rename across files, and learn about type errors without a build
step. A module, so it can be turned on or off.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | An `LSP` tool: definition, references, type at a position, symbols in a file or workspace, implementations, call hierarchy. After each edit it reports errors and warnings on its own. Inactive until a code-intelligence plugin for the language is installed; the user installs the server binary. |
| OpenCode | An experimental `lsp` tool over language servers set in config: definitions, references, hover. |
| Codex CLI | None. |
| Serena | An MCP server built on language servers; see [inspiration](../inspiration/serena.md). The richest tool set of the four, below. |

## What to take from Serena

- **Address code by name path, not position.** `find_symbol("MyClass/method")` with a `depth` for children and an
  optional body. A name path survives edits; a line number doesn't.
- **Its tool list:** `get_symbols_overview` (a file's outline), `find_symbol`, `find_referencing_symbols`,
  `find_implementations`, `find_declaration`, `rename_symbol` (across files, through the server), and later the
  symbol edits (`replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`, `safe_delete_symbol`).
- **No diagnostics after every edit.** Serena has the code but ships it off: one edit often breaks what the next one
  fixes, so per-edit errors are noise. Here, diagnostics come at the end of a turn through the
  [done check](done-check.md), or when the agent asks.
- **A cap on every answer** (`max_answer_chars`), with a clear message when it's hit, following the output rules in
  [tools](../tools/README.md#rules-for-every-built-in-tool).
- **Trusted projects only** for per-project server settings: a cloned repo shouldn't be able to choose the binary
  that runs.

## Behavior

- A tool or a small set of tools: outline, find symbol, references, implementations, definition, rename. All read-only
  except rename, so they work in Plan mode.
- Diagnostics for a file on request, and for the files a turn changed through the done check.
- Servers start when a file of their language is first touched, and stop when the session ends.
- Needs the language server installed (`typescript-language-server`, `gopls`, `rust-analyzer`, and so on). A missing
  server is a clear error, not a crash.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/lsp/` | Load type `ON_DEMAND`? Open question. |
| Client | JSON-RPC over the server's stdio | Microsoft's `vscode-languageserver-protocol` at `^3.18.5`, not a hand-written client (passed the dependency rule in AGENTS.md 2026-10-23). Import from `vscode-languageserver-protocol/node`: it re-exports `vscode-jsonrpc/node` and pins its own copy, so `vscode-jsonrpc` isn't declared separately; a second range could drift and install a mismatched copy. Started from a tool or `session_start`, closed in `session_shutdown`. |
| Diagnostics after a turn | Asked for by the [done check](done-check.md) | Pi lets an extension rewrite another tool's result (`tool_result` returns `content`, checked in pi 1.2.0's `types.d.ts`), so per-edit diagnostics stay possible if they're ever wanted. |
| Tools | Returned from the module's `tools()`, in `src/module/lsp/tools/` | `readOnlyHint: true` on the readers, so they work in Plan mode. |
| Server config | A map of language → command, with defaults | Per-project settings only for trusted projects. Where it lives is open. |

## Slices

1. One language (TypeScript), the client, and server start and stop.
2. Outline and find symbol by name path.
3. References, implementations, definition.
4. Diagnostics on request, and for the done check.
5. Rename.
6. Symbol edits, if the agent turns out to need them.

## Open questions

- Load type: `ON_DEMAND` or `ON_LOAD`?
- Which languages and servers after TypeScript?
- One tool with an `action`, or one tool per operation (Serena's way)? Each tool's schema costs context in every
  request.
- Where server config lives.
- How it sits next to ripwire, once I install it: LSP is exact and per language; ripwire is fast, offline, and ranks
  by task.

## References

- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § LSP tool behavior
- OpenCode docs: [tools](https://opencode.ai/docs/tools/) (`lsp`)
- [Serena](../inspiration/serena.md): `src/serena/tools/symbol_tools.py`, `EditingToolWithDiagnostics` in
  `tools_base.py`
- [ripwire](../inspiration/ripwire.md): edit receipts, a check when the agent is done
- [Language Server Protocol spec](https://microsoft.github.io/language-server-protocol/)
