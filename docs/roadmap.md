# Roadmap

What to build next, and why. Asked "what should we build next?", start from **Next up**: the first row that isn't
done, unless something below says otherwise. When something moves, update its status in its own doc and its row
here; when the order changes, say why in the row.

## Next up

Proposed order, agreed 2026-10-22; subagents moved above analytics and worktree above subagents 2026-10-23. Change it freely.

| # | What | Kind | Why at this point | Needs first |
|---|---|---|---|---|
| 1 | [memory](modules/memory.md) | module | **Done 2026-10-23.** Small, no dependencies, and every later session gets better from it. Also answers pair-programmer's "how does it remember how I work". | Nothing |
| 2 | [lsp](modules/lsp.md) | module | Exact navigation by symbol, and the diagnostics the done check wants. | Microsoft's `vscode-jsonrpc` and `vscode-languageserver-protocol` |
| 3 | [done-check](modules/done-check.md) | module | Catches broken work before I see it. Can start with commands only (typecheck, tests) and add LSP diagnostics once 2 is done. | Nothing; LSP makes it better |
| 4 | [worktree](tools/worktree.md) | tool | Optional for me, but sub-agent writers need it to work in parallel: each gets its own worktree (moved above subagents 2026-10-23). | Slice 1: prove which route changes the cwd in pi |
| 5 | [subagents](modules/subagents.md) | module | The main window orchestrates: specialists (architect, developer, reviewer, and ones I create) run in the background with their own model and effort, and their answers wake it. A fleet view. Internal (pi's SDK) first, milestone 1 before the rest; external harnesses in herdr panes later. Before analytics so analytics tracks runs per agent, model and effort from the start. | Slice 1, a spike that proves models and logins work in process; 4 (worktree) for parallel writers |
| 6 | [analytics](modules/analytics.md) | module | Evidence before any nudges or benchmarks: whether memory, LSP, sub-agents and ripwire actually get used, and what to build after. | `node:sqlite` (built in); sub-agent runs (5) |
| 7 | [todo](tools/todo.md) | tool | Must-have built-in: a checklist the user can follow. | Nothing |
| 8 | [apply_patch](tools/apply-patch.md) | tool | Must-have built-in: multi-file edits for GPT models, with edit receipts. | Nothing |
| 9 | [notifications](modules/notifications.md) | module | Small; most useful once runs get longer. | Nothing |
| 10 | [pair-programmer](modules/pair-programmer.md) | module | The mode MyPi was started for, but it needs memory to remember how I work. | 1 (memory) |

## Deferred

| What | Why | When to pick it up |
|---|---|---|
| ripwire | I install it myself later: the binary, then `skills/install.sh --codex` puts its skills in `~/.agents/skills/`, which pi reads. No MyPi code. See [ripwire](inspiration/ripwire.md). | Whenever I choose; then check it with analytics. |
| MCP-backed tools (code_search) | Need a server that offers them keyless. See [tools](tools/README.md#deferred). | When such a server exists. |
| SearXNG for web_search | Not installing it yet. See [web-search](tools/web-search.md). | If the hosted backends get unreliable. |

## Done

- Core: module loading (`/modules`), `PromptManager`, `ToolGuard` with "Allow for this session" and the writable list
  (`setWritable`), the shared footer and editor, `JobManager`, `keepOutOfGit`. See [architecture](architecture.md).
- [plan-build](modules/plan-build.md), with Plan's shell check.
- [memory](modules/memory.md): project and global memories in the prompt, `/onboard`, `/memory-check`. Whether the
  agent saves on its own depends on the model; [analytics](modules/analytics.md) measures it before any nudge.
- Built-in tools: [web_search](tools/web-search.md), [web_fetch](tools/web-fetch.md),
  [background process](tools/background-process.md) (`bash` with `background: true`, `job_list`, `job_stop`).
- [MCP server list](mcp/README.md): Parallel and Exa.

## How to choose

- Prefer what makes later work cheaper or better informed (memory, analytics) over what only adds a feature.
- Measure before steering: no hints or blocks that push the agent toward a tool until analytics shows it's worth it.
  See [analytics](modules/analytics.md#measuring-what-mypi-adds).
- Before calling a new tool done, run a self-evaluation prompt on it (Serena's method, same section).
- Run an outside tool before wrapping it: if it works from bash and skills, it needs no MyPi code (ripwire).
- New dependencies follow the rule in [AGENTS.md](../AGENTS.md#rules).
- Write down what was tried and rejected, in the doc of the thing it was for, so it isn't tried again blind. Example:
  tree-sitter for Plan's shell check, in [plan-build](modules/plan-build.md#plan-rule).
- Ideas from outside projects start in [inspiration](inspiration/README.md), then move into a module's or tool's doc
  once picked.
