# Serena

**Source:** [oraios/serena](https://github.com/oraios/serena), read at `abb0a0f` (2026-10-20, v2.1.1.dev0).
**License:** GPL-3.0-or-later for the app, MIT for its LSP layer (`src/solidlsp`). MyPi takes ideas, not code.

## What it is

"The IDE for your coding agent": an MCP server, in Python, that gives any agent symbol-level tools backed by
language servers (40+ languages) or a paid JetBrains plugin. The agent finds, reads, and edits code by symbol
(`MyClass/method`) instead of by line number or text pattern. It also ships a Markdown memory system, onboarding, and
layered config (contexts and modes). In a harness like Claude Code or Codex its plain file and shell tools are off,
since the harness already has them.

## What's worth taking

| Idea | How Serena does it | For MyPi | Feeds |
|---|---|---|---|
| Symbol tools | `find_symbol` (name path pattern, `depth` for children, `include_body`), `get_symbols_overview` (file outline), `find_referencing_symbols`, `find_implementations`, `find_declaration` | The tool list for the LSP module, beyond definition/references/hover. A name path is a steadier address than a line number, which shifts after every edit | [lsp](../modules/lsp.md) |
| Symbol edits | `replace_symbol_body`, `insert_before_symbol`, `insert_after_symbol`, `rename_symbol` (cross-file, through the server), `safe_delete_symbol` | Later LSP slices. Rename is the one an agent can't do well by text, so it comes first | [lsp](../modules/lsp.md) |
| Diagnostics after edits are off by default | `EditingToolWithDiagnostics` diffs diagnostics before and after an edit, but `ENABLE_DIAGNOSTICS = False`: "individual edits often intentionally introduce diagnostics … that are then resolved in subsequent edits" | Answers an LSP open question. Report diagnostics when the agent asks, or once the turn ends (`agent_settled`), not after every edit. Report only what got worse, as a before/after diff | [lsp](../modules/lsp.md) |
| Answer size cap | `max_answer_chars` on every tool, with a clear message when the answer is too long | MyPi already caps web_fetch; the same rule fits LSP results | [lsp](../modules/lsp.md) |
| REPL interface | v2's optional mode: one tool runs Python against facades (`s.lsp.find_symbol(...)`), so the agent chains calls, keeps variables, and only the result enters context | pi already has this: `codemode` (QuickJS script over every tool, `store`/`load`, `searchTools`). Nothing to build; make MyPi's tools work well from codemode (structured results, `outputSchema`) | [tools](../tools/README.md) |
| Modes that change prompt and tools | `planning` mode = a prompt line + a list of excluded edit tools. Modes stack (`base_modes` + `default_modes` + `added_modes`) | Same shape as plan-build (prompt section + tool rule). A stackable "mode" idea for other modules (one-shot, interactive) if they come up | [plan-build](../modules/plan-build.md) |
| Contexts per host | `claude-code`, `codex`, `ide` contexts drop tools that duplicate the host's | The rule behind "built-in tools are core": don't add a tool pi already has | [tools](../tools/README.md) |
| Memories | Plain Markdown in `.serena/memories/` (project, committed) and `~/.serena/memories/global/`. The agent gets the list of names up front and reads what it needs. Topics via `/` in names; `` `mem:name` `` references, rewritten on rename and checked by `serena memories check`; read-only and ignored patterns | A memory module idea. Their design rules are worth keeping: human-editable files, names up front (progressive disclosure), references over search, the agent reads on purpose and the harness doesn't inject. Compare pi's own `AGENTS.md`/skills before building | new: memory |
| Onboarding | First time in a project with no memories, a tool tells the agent to learn the structure, build, and tests, and write memories; it seeds a `memory_maintenance` memory with the conventions first | Fits a memory module, or a `/onboard` prompt template in `resources/prompts/` | new: memory |
| Grep/read nudge | A Claude Code `PreToolUse` hook counts bursts of grep and file reads; at a threshold it denies once with "use the symbolic tools", then stays quiet for 2 minutes. A Serena call resets the counters | Possible for LSP through MyPi's `ToolGuard`, but see [ripwire](ripwire.md): its own A/B found this kind of nudge did nothing. Measure first (analytics) | [lsp](../modules/lsp.md), [analytics](../modules/analytics.md) |
| Trusted projects | Project config can run a shell command on activation and choose how language servers start; those settings are ignored unless the project path matches `trusted_project_path_patterns` | If the LSP module reads per-project server config, a cloned repo shouldn't be able to pick the binary that runs. Default to trusted-only | [lsp](../modules/lsp.md) |
| Agent self-evaluation | One prompt has the agent do ~20 tasks both ways (Serena vs. built-ins), count calls and payload sizes, `git diff` the edits, and report gains and non-gains | A cheap first benchmark for a new MyPi tool or module, before the analytics benchmark suite exists | [analytics](../modules/analytics.md) |

## Not for MyPi

- **The JetBrains backend.** Paid plugin; moves, inlining, and the debugger only exist there.
- **Its own file, shell, and search tools.** pi has them.
- **Project activation and switching.** pi has one cwd per session.
- **The dashboard and YAML config layers.** More than a personal harness needs; MyPi config stays in code and
  `/modules`.

## References

- Tools: `src/serena/tools/symbol_tools.py`, `tools_base.py` (`EditingToolWithDiagnostics`)
- Memories: `docs/02-usage/045_memories.md`
- Modes and contexts: `docs/02-usage/050_configuration.md`, `src/serena/resources/config/modes/`
- Nudge hook: `src/serena/hooks.py` (`PreToolUseRemindAboutSymbolicToolsHook`)
- Evaluation: `docs/04-evaluation/010_methodology.md`, `020_prompts/010_evaluation-prompt.md`
