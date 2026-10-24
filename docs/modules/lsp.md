# LSP

**Status:** building (slices 1 and 2 done 2026-10-24)

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

- Two tools, split by reading and writing: `lsp` reads (outline, find symbol, references, implementations,
  definition, diagnostics) and works in Plan mode; `lsp_edit` changes files (rename, later the symbol edits).
- Diagnostics for a file on request, and for the files a turn changed through the done check.
- A server starts on first use: the first `lsp` call for a file of its language starts it, and that call waits for
  it (about 0.4 s for MyPi). Nothing runs in a session that never calls the tool. One server runs per language and
  project root: the nearest folder above the file holding one of the server's root markers (the outermost one for
  gopls), or the session's folder when none does. Planned with [folder-guard](../rules/folder-guard.md#the-lsp-module): for a
  file inside the session's folder, a root above that folder is clamped to it.
- Servers stop when they're turned off in `/lsp` or the session ends: `shutdown` and `exit` as the protocol asks,
  then a kill after a second.
- A server that fails to start warns once, with the end of its stderr, and isn't retried until Save in `/lsp`. One
  that exits on its own warns and starts again with the next `lsp` call.
- Needs the language server installed (`tsc` from TypeScript 7, `gopls`, `rust-analyzer`, and so on). MyPi never
  installs one. A missing server is a clear error with its install command, not a crash.
- Every server that's installed is on by default; the `/lsp` menu turns one off.

## The `/lsp` menu

Part of the module from slice 1, even with TypeScript as the only row. A modal on the existing `Dialog` and
`ToggleList` (`src/ui/components/`), the same look and keys as `/modules`, built in `src/module/lsp/menu.ts`:

```
 LSP servers
 → TypeScript: running            ●
   Rust: not installed            ○
   Save

   /usr/local/bin/tsc --lsp --stdio
   Running in /Users/me/project
```

- One row per server in the list below, with its state: `installed`, `starting`, `running`, `failed`, `off`, or
  `not installed`. The selected row's description shows the command and where it runs or failed, or the install
  command when it's missing.
- A server that isn't installed is a disabled row (`ToggleItem.disabled`): dimmed, and it can't be turned on.
- Turning a running server off stops it; tool calls for its language then say it's off and point to `/lsp`.
- Save applies at once (no `/reload`), forgets failed starts so they're tried again, and saves the off set with
  `BaseModule.saveState`, the way `/modules` saves its selection.
- `/lsp list` prints the same state lines, for when there's no TUI.

## The `lsp` tool

One tool with an `action`, marked `readOnlyHint: true` (`src/module/lsp/tools/lsp.ts`). Slice 2 brought `outline` and
`find_symbol`; slices 3 and 4 add the other read actions.

| Parameter | For | Meaning |
|---|---|---|
| `action` | all | `outline` or `find_symbol`. |
| `path` | `outline` (required), `find_symbol` (optional) | Resolved like `read`'s path. `outline` takes a file (a folder is an error). `find_symbol` takes a file, to search only it, or a folder inside a project, to search that project and keep only matches inside the folder; without it, the search covers the project of the session's folder. |
| `name_path` | `find_symbol` | Which symbol, by Serena's rule (below). |
| `include_body` | `find_symbol` | `true` adds each match's source. Off by default, so finding where something is stays cheap. |

**Name paths (Serena's rule).** A name path is a symbol's names from the top of its file down, joined with `/`:
`ServerManager/touch`.

- A single name, `touch`, matches every symbol with that name, at any depth.
- A relative path, `ServerManager/touch`, matches any symbol whose name path ends with it.
- An absolute path, `/ServerManager/touch`, matches only from the top of the file.
- Names match exactly. Serena's opt-in `substring_matching` is left out until the agent turns out to need it.
- gopls names a method `(*Server).Touch`, at the top of the file rather than inside its type; it reads as
  `Server/Touch`, so the same name paths work in Go.

**Output.** One line per symbol: its kind, its name path, and `file:start-end`, such as
`method ServerManager/clientFor  src/module/lsp/manager.ts:49-53`. `outline` indents children under their parents
and prints the full name path, ready to pass to `find_symbol`; what's declared inside a function or method (its
locals) is left out (`namedSymbols`). A match with `include_body` is followed by its source.
A project-wide search names the projects it searched, and adds "Not searched: …" for a server of the project that
couldn't answer.

- Answers are capped at about 20,000 characters (`MAX_ANSWER_CHARS`). A cut answer says how many symbols it left out
  and how to narrow the call (a file or folder as `path`, a longer name path, no `include_body`), following the
  [tool rules](../tools/README.md#rules-for-every-built-in-tool).
- No match reads as "no symbol matches `<name_path>`" plus where it looked, never "it doesn't exist": the server may
  not have indexed every file.

**Underneath.**

- **Document sync** (`LspClient.sync`). Before each request, the tool sends the file's text from disk: `didOpen` the
  first time, and `didChange` with the full text when it changed since it was last sent. A project search first
  re-sends every open file that changed (`syncOpen`), or the server answers from old text.
- **Files changed on disk.** A server keeps its own copy of files that aren't open, and `tsc --lsp` doesn't notice
  changes on its own (checked: an edited file stayed old after waiting). Changes are reported to the servers with
  `workspace/didChangeWatchedFiles`, two ways, and no watcher runs in the background:
  - **Checked before each project search** (`ServerManager.projectClients`). When a server starts, the module records
    the modification time of each of its project's source files (`sourceFileTimes` in `util/walk.ts`: the files with
    its extensions, skipping hidden folders and `node_modules`, in up to 2,000 folders). Before each project-wide
    search it looks again and reports what was created, changed, or deleted since (`fileChanges`), however it
    happened: the agent, bash, `git checkout`, or the user's editor. A scan took 4 ms for MyPi (142 files) and
    245 ms for a 2,768-file tree (2026-10-24).
  - **The agent's own edits, at once.** A `tool_result` handler reports each file the agent's `edit` (as changed) or
    `write` (as created) touched, and records its time so the next check doesn't report it again. `write` is
    reported as created because pi doesn't say whether it made the file; a server takes "created" for a file it knew
    as "read it again", and ignores "changed" for one it didn't know (checked with `tsc --lsp`).
  - An open file that's gone from disk is closed (`didClose`), and a match in a file that's gone is skipped.
- **Requests.** `outline` is `textDocument/documentSymbol`, with `hierarchicalDocumentSymbolSupport` declared in
  `initialize` so the server sends a tree, not a flat list. `find_symbol` with a file walks that same tree. With a
  folder or nothing, it runs on every server whose root markers are at or above that folder, or the session's folder
  (`ServerManager.projectClients`): it asks
  `workspace/symbol` for the last name, keeps the files whose matches have exactly that name (servers match loosely:
  `touch` also returns `touched`), and walks the tree of each, at most 20 (`MAX_SEARCH_FILES`; the answer says how
  many more), to check the whole path.
- **Root.** `initialize` sends the project root as the one workspace folder, and declares
  `workspace.workspaceFolders`. `rootUri` is deprecated "in favour of `workspaceFolders`" (LSP 3.17, and the 3.18
  draft) but still a required field, so it's sent as `null`. All three servers find their project that way (checked
  2026-10-24).
- **Settings.** The client declares `workspace.configuration` and answers each settings request with empty settings
  (the server's defaults). Pyright waits for that answer before it indexes the project.
- **Before a project search** (`beforeSearch` in the server list). Servers differ in when a project search works:
  - `open_file` (TypeScript): it searches nothing until a file of the project is open, so the tool opens one first
    (`findSourceFile` in `util/walk.ts`: nearest folders first, skipping hidden folders and `node_modules`).
  - `wait_for_index` (Pyright): it indexes for a few seconds after starting, and an open file would make the first
    answer cover only that file. An empty answer is asked again every 0.5 s until 5 s after the server started.
  - unset (gopls): it answers once started.
- **Checked 2026-10-24** with `tsc --lsp` (7.0.2), gopls (v0.23.0), and Pyright (1.1.414): all three offer
  `workspaceSymbolProvider` and `documentSymbolProvider`, take open, close, and change notices, and send a tree once
  `hierarchicalDocumentSymbolSupport` is declared. A server without `workspaceSymbolProvider` isn't handled; none of
  the three needs it.
- **Known gaps.**
  - Changes in folders past the first 2,000 aren't seen by the check before a search.
  - `tsc --lsp` lists a file's imports as `variable` symbols at the top of the outline, and labels type aliases
    `class`. That's the server's answer, passed on as is.

## When a server can't answer

The `lsp` tool fails with a message written for the agent, so it can tell the user what to do. The agent passes it
on in its reply; there's no separate UI warning until [analytics](analytics.md) shows agents don't.

| Case | The tool's error |
|---|---|
| Not installed | `TypeScript language server isn't installed (tsc not found on PATH). Tell the user to install it with: npm i -g typescript (version 7 or later), then try again. Don't install it yourself.` |
| Turned off | `TypeScript is turned off in /lsp. Ask the user to turn it on there.` |
| Failed to start | The start error with the end of the server's stderr, then `Tell the user to fix it, then press Save in /lsp to retry.` |
| No server for the file | `No language server for .md files.` The agent falls back to reading the file. |

- **"Don't install it yourself" is on purpose.** Without it, a capable model often runs `npm i -g …` in bash, a
  global install the user never asked for. MyPi never installs a server, and neither does the agent on its behalf.
- The wording names the server's `language`, `command`, and `install` from its entry in the server list, so a new
  server gets the same messages for free.
- `ServerManager.clientFor` returns which case it hit (a `Lookup`), and the tool throws the matching error
  (`unavailable` in `tools/format.ts`). A server that stops with the session says so.

## Adding a server

One entry in the server list in code, `src/module/lsp/servers.ts`. No config file: adding an entry is already the easy
path while MyPi is improved per machine with MyPi itself. A config file for user servers, and per-project settings
for trusted projects, waits until a server is wanted without editing code.

```ts
export const SERVERS = [
  {
    id: "typescript",
    language: "TypeScript",
    command: "tsc",
    args: ["--lsp", "--stdio"],
    languageIds: { ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", /* … */ },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    beforeSearch: "open_file",
    install: "npm i -g typescript (version 7 or later)",
  },
] as const satisfies readonly ServerSpec[];
```

- `languageIds` picks the server for a file by extension, and gives the language id the file is opened as.
- `rootMarkers` finds the project root it starts in: the nearest folder holding one, or the outermost with
  `outermostRoot: true`, for a server meant to run once per workspace (gopls).
- `beforeSearch` says what a project-wide search needs first; see [The `lsp` tool](#the-lsp-tool).
- `command` is a name on `PATH` or an absolute path; `install` is the hint shown when it can't be found, in the menu
  and in tool errors.
- Fields such as `initializationOptions` are added when a server first needs them.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/lsp/` | Load type `ON_LOAD`: on by default, and it costs nothing until a server starts. |
| Client | JSON-RPC over the server's stdio | Microsoft's `vscode-languageserver-protocol` at `^3.18.5`, not a hand-written client (passed the dependency rule in AGENTS.md 2026-10-23). Import from `vscode-languageserver-protocol/node`: it re-exports `vscode-jsonrpc/node` and pins its own copy, so `vscode-jsonrpc` isn't declared separately; a second range could drift and install a mismatched copy. Started by the `lsp` tool, closed in `session_shutdown`. |
| Diagnostics after a turn | Asked for by the [done check](done-check.md) | Pi lets an extension rewrite another tool's result (`tool_result` returns `content`, checked in pi 1.2.0's `types.d.ts`), so per-edit diagnostics stay possible if they're ever wanted. |
| Tools | `lsp` and `lsp_edit`, each with an `action` parameter, returned from the module's `tools()` | One schema per side instead of one per operation keeps the context cost per request down. `lsp` is marked `readOnlyHint: true`, so Plan mode allows it. `lsp_edit` arrives with rename in slice 5 and isn't marked read-only, so Plan mode asks first, like any other tool that writes. Two tools because Plan's rule (`src/module/plan-build/rule.ts`) judges a whole tool, not an action; the alternative, a seam that lets a tool say which inputs are read-only, would change core and plan-build for one user. |
| Menu | `/lsp` command from the module's `commands()` (`commands/lsp.ts`), UI in `menu.ts` | See [The `/lsp` menu](#the-lsp-menu). |
| Servers | `ServerManager` (`manager.ts`) over `LspClient` (`client.ts`); `markedFolders` and `findCommand` in `util/lookup.ts`; `findSourceFile`, `sourceFileTimes`, and `fileChanges` in `util/walk.ts` | Started by the `lsp` tool on first use (`clientFor`, `projectClients`); stopped on `session_shutdown`. `projectClients` reports what changed on disk since the last look; a `tool_result` handler reports the agent's edits and writes at once (`fileChanged`). Both handlers are registered in `init()`: pi builds a new extension runtime for every session, so they don't stack. |
| Name paths | `symbols.ts` | Pure: a server's outline to name paths (`namedSymbols`), Serena's rule (`matchesNamePath`), kind names. |
| Server list | `src/module/lsp/servers.ts` | See [Adding a server](#adding-a-server). |

## Slices

1. **Done 2026-10-24.** One language (TypeScript), the client, server start and stop, and the `/lsp` menu. Go
   (`gopls`) added the same day, rooted at the outermost `go.work` or `go.mod`, so a workspace runs one server.
   Python (`pyright-langserver --stdio`, from `npm i -g pyright`) added after that.
2. **Done 2026-10-24.** The [`lsp` tool](#the-lsp-tool) with `outline` and `find_symbol`, document sync, reports
   of the agent's file changes, and the answer cap. Servers start through `ServerManager.clientFor`, which reports
   the cases in [When a server can't answer](#when-a-server-cant-answer).
3. References, implementations, definition.
4. Diagnostics on request, and for the done check.
5. Rename, as the first action of `lsp_edit`.
6. Symbol edits in `lsp_edit`, if the agent turns out to need them.

## Tried and rejected

- **`typescript-language-server` for TypeScript** (2026-10-24). It wraps `tsserver.js`, which TypeScript 7 no longer
  ships, so it fails to start in any project on TypeScript 7 (MyPi included), and `npm i -g typescript` now installs
  7. TypeScript 7's `tsc --lsp --stdio` is its own language server and needs nothing else.
- **Starting servers on read, edit, and write** (built in slice 1 and removed the same day, 2026-10-24; OpenCode does
  this). It keeps a server warm for the first `lsp` call, but every session that touches a file of its language pays
  for a background process per project root, used or not. Starting on first use costs nothing until the tool is
  called. If [analytics](analytics.md) shows the first call is too slow, starting on read is a one-line change.

- **A file watcher for changes outside the agent** (2026-10-24). `fs.watch` per project root would catch every change
  as it happens, but it's a background resource per project, and on Linux it sets a watch in every folder,
  `node_modules` included, which can hit system limits. Checking modification times before each project search
  catches the same changes with nothing running in between. If analytics shows the scan is slow in large repos, a
  watcher can come then.

## Decided 2026-10-24

- `/lsp` menu in the module from slice 1, even with one language.
- Servers are a list in code; no config file yet.
- Load type `ON_LOAD`.
- One `lsp` tool with an `action` for everything that reads, not one tool per operation.
- A second tool, `lsp_edit`, for everything that writes: rename in slice 5, then the symbol edits in slice 6.
- Servers start on first use of the tool, not when a file is read.
- A server that can't answer is a tool error telling the agent what to ask the user, including "don't install it
  yourself".
- `find_symbol` searches the whole project by default; `path` narrows it to a file or a folder. A folder also lets
  the agent search a project below the session's folder: when pi runs in a folder that holds projects but isn't one
  (seen in a live test, 2026-10-24), a search without `path` fails with "pass a file, or a folder inside a project".
- Outlines and searches leave out what's declared inside a function, method, or constructor. `tsc --lsp` and Pyright
  list locals and the fields of object literals inside methods (16 symbols where 7 mattered in a live test); classes,
  their members, and top-level declarations stay. Serena gets the same effect with a depth setting.
- Name paths follow Serena's rule: a name, a relative path matched from the end, or an absolute path from a leading
  `/`. Exact names only.
- Source comes back only with `include_body: true`.
- Answers are capped at about 20,000 characters, with a note on how to narrow the call.
- Changes on disk, from the agent or anything else, are found by checking modification times before each project
  search, not by a watcher.

## Open questions

- Which languages and servers after TypeScript, Go, and Python?
- Look in the project's `node_modules/.bin` too? Most TypeScript projects have `tsc` there, so it would work without
  a global install (this machine has none). About 5 lines in `lookup.ts`, but then a cloned repo picks the binary
  that runs, which the trusted-projects rule above is about.
- How it sits next to ripwire, once I install it: LSP is exact and per language; ripwire is fast, offline, and ranks
  by task.

## References

- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § LSP tool behavior
- OpenCode docs: [tools](https://opencode.ai/docs/tools/) (`lsp`)
- [Serena](../inspiration/serena.md): `src/serena/tools/symbol_tools.py`, `EditingToolWithDiagnostics` in
  `tools_base.py`
- [ripwire](../inspiration/ripwire.md): edit receipts, a check when the agent is done
- [Language Server Protocol spec](https://microsoft.github.io/language-server-protocol/)
