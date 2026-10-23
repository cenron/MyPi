# LSP

**Status:** idea

## Goal

Code intelligence from language servers: type errors and warnings after each edit, so the agent fixes them without a
build step, plus go to definition, find references, and hover types. A module, so it can be turned on or off.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | An `LSP` tool: definition, references, type at a position, symbols in a file or workspace, implementations, call hierarchy. After each edit it reports errors and warnings on its own. Inactive until a code-intelligence plugin for the language is installed; the user installs the server binary. |
| OpenCode | An experimental `lsp` tool over language servers set in config: definitions, references, hover. |
| Codex CLI | None. |

## Behavior

- After `write`, `edit`, or `apply_patch`, the result also lists new errors and warnings in that file.
- A tool for definition, references, and hover at a file position.
- Servers start when a file of their language is first touched, and stop when the session ends.
- Needs the language server installed (`typescript-language-server`, `gopls`, `rust-analyzer`, and so on). A missing
  server is a clear error, not a crash.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/lsp/` | Load type `ON_DEMAND`? Open question. |
| Client | JSON-RPC over the server's stdio | `vscode-jsonrpc` or a small hand-written client. Started from a tool or `session_start`, closed in `session_shutdown`. |
| Diagnostics after edits | `tool_result` event on `write`/`edit`/`apply_patch` | Append the file's diagnostics to the result. Check pi lets an extension change another tool's result. |
| Tool | Returned from the module's `tools()`, in `src/module/lsp/tools/` | `readOnlyHint: true`, so it works in Plan mode. |
| Server config | A map of language → command, with defaults | Where it's configured is an open question. |

## Open questions

- Load type: `ON_DEMAND` or `ON_LOAD`?
- Which languages and servers to support first (TypeScript for MyPi itself)?
- Diagnostics after every edit, or only when asked?
- Where server config lives.

## References

- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § LSP tool behavior
- OpenCode docs: [tools](https://opencode.ai/docs/tools/) (`lsp`)
- [Serena](../inspiration/serena.md): symbol tools, symbol edits, why per-edit diagnostics are off
- [ripwire](../inspiration/ripwire.md): edit receipts, a check when the agent is done
- [Language Server Protocol spec](https://microsoft.github.io/language-server-protocol/)
