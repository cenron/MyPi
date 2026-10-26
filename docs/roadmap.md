# Roadmap

What to build next, and why. Asked "what should we build next?", start from **Next up**: the first row that isn't
done, unless something below says otherwise. When something moves, update its status in its own doc and its row
here; when the order changes, say why in the row.

## Next up

Proposed order, agreed 2026-10-22; subagents moved above analytics and worktree above subagents 2026-10-23; folder-guard added after lsp 2026-10-24; folder-guard slice 4 and identity added before worktree 2026-10-25; plan-build slice 9 added after worktree 2026-10-25; context B–D added and subagents made foundational 2026-10-25; self-build fixes and todo moved before subagents milestone 2, which tests them, 2026-10-26. Change it freely.

| # | What | Kind | Why at this point | Needs first |
|---|---|---|---|---|
| 1 | [memory](modules/memory.md) | module | **Done 2026-10-23.** Small, no dependencies, and every later session gets better from it. Also answers pair-programmer's "how does it remember how I work". | Nothing |
| 2 | [lsp](modules/lsp.md) | module | **Done 2026-10-24** (servers and `/lsp` menu; `lsp`: outline, find_symbol, references, implementations, definition, diagnostics; `lsp_edit`: rename). Symbol edits wait for a need; diagnostics after a turn come with the done check. | Microsoft's `vscode-languageserver-protocol` (passed the dependency check 2026-10-23) |
| 3 | [folder-guard](rules/folder-guard.md) | core rule | **Done 2026-10-24** (tools with a `path`, `bash`, and lsp roots). Added 2026-10-24 after a live test where pi ran `find` over the home folder unasked. Small, and every session is safer with it. | Nothing; reuses `ToolGuard` and Plan's `tokenize` |
| 4 | [done-check](modules/done-check.md) | module | **Done 2026-10-24** (the event bus; after each Build run, LSP errors in the changed files and the project's approved commands, sent back to the agent). Counting its catches moved to analytics. | 2 (lsp); slice 1 builds MyPi's event bus over `pi.events`, which LSP and plan-build answer on |
| 5 | [folder-guard slices 4–6](rules/folder-guard.md#slices) | core rule | **Done 2026-10-25:** slice 4, slice 5 (fewer false asks: `/tmp` allowed, patterns and markup no longer read as paths), and slice 6 (home and above are allowed as that path only, never as a tree). "Allow for this session" on a folder allows everything under it, as every other harness does. A live test working on MyPi from another folder asked again for each file. Small, and the worktree work reaches outside its folder all the time. | Nothing; a small seam on `ToolGuard` |
| 6 | [identity](core/identity.md) | core | **Done 2026-10-25.** pi's prompt says only "inside pi", nothing about MyPi or the model; a few prompt lines fix it and give it the paths to its own roadmap and docs, so "improve yourself, what's next?" works from any folder without searching. One small slice. | 5 (one "Allow for this session" covers MyPi's folder); `PromptManager` |
| 7 | [worktree](tools/worktree.md) | commands/core | **Done 2026-10-25.** `/worktree` enter, exit, list, and remove move a conversation into a git worktree and back; memories and plans stay shared with the main checkout; `Session.worktrees` is ready for subagents (which still need a discard step, see its doc). | — |
| 8 | [plan-build slice 9](modules/plan-build.md#slices) | module | **Done 2026-10-25.** Plans that hand over cleanly: Clear context is the default implement choice, the plan file carries every decision from the chat, plans name the existing API they checked before adding machinery, and no new session while jobs run. Found building worktree in one long session. Small, and every later slice benefits. | Nothing |
| 9 | [context](modules/context.md#pieces) | module and plan-build | **A–E done 2026-10-25.** Long sessions drift: keep the plan file named in Build's section, steer compaction summaries, re-check the principles before "done", and clear old large tool results in batches. A (compact earlier) is already a setting. | Nothing |
| 10 | [subagents](modules/subagents.md) milestone 1 | module | **Done 2026-10-26:** `subagent` runs `explore`, `general`, `architect`, `developer`, `reviewer` and the user's own agents in child sessions, in the background as jobs or in the foreground; access and the folder guard in every child; grouped completions and `job_wait`. **Foundational (2026-10-25):** research and checks in their own context, like Claude Code's small background agents, as well as delegated work. | — |
| 11 | Self-build fixes | core, modules, config | **Done 2026-10-26.** Small fixes from the milestone 1 post-mortem (`.pi/plans/2026-10-26-session-review.md`, git-ignored), including the live-check follow-ups (Herdr-forwarded text no longer triggers folder-guard prompts, and the done check skips Git-ignored files): (a) Biome's `noUndeclaredDependencies` refuses an import from a package MyPi doesn't declare (it came back twice); (b) the [done check](modules/done-check.md#slices) says in one line what ran when it passed (slice 4); (c) [`/plan implement`](modules/plan-build.md#slices) keeps the session's thinking level (slice 10); (d) `ToolGuard`'s answer without a UI says the call is refused and no one can approve it here ([subagents](modules/subagents.md#access-and-plan-mode)); (e) `AGENTS.md`'s "Live checks" names the herdr skill, and pi now runs its own interactive live checks. | Nothing |
| 12 | [todo](modules/todo.md) | module | **Done 2026-10-26.** Claude Code's task tools and UI: tasks one at a time with `activeForm`, the rules in the descriptions, a transient reminder with the open list, a widget above the editor, plan seeding, and open-task reporting in the done check. Aimed at milestone 1's main failure: pi stopped partway in 4 of 5 checkpoints. | Nothing |
| 13 | [subagents](modules/subagents.md#slices) milestones 2–3 | module | The fleet view and parallel writers (milestone 2), then creating agents (milestone 3). **Milestone 2 is the test bed for 11 and 12** (the user's call, 2026-10-26): built by pi on gpt-6-luna at **high** thinking, with the same Observations log per checkpoint plus the data to compare with milestone 1: passes per checkpoint, early stops, rebuilt-instead-of-reused APIs, rules with no failing test, whether the todo list was seeded and finished, what the done check caught, pi's cost and context. | 7 (worktree) and its discard step; 11, 12 |
| 14 | [analytics](modules/analytics.md) | module | Evidence before any nudges or benchmarks: whether memory, LSP, sub-agents and ripwire actually get used, and what to build after. | `node:sqlite` (built in); sub-agent runs (10) |
| 15 | [apply_patch](tools/apply-patch.md) | tool | Must-have built-in: multi-file edits for GPT models, with edit receipts. | Nothing |
| 16 | [notifications](modules/notifications.md) | module | Small; most useful once runs get longer. | Nothing |
| 17 | [pair-programmer](modules/pair-programmer.md) | module | The mode MyPi was started for, but it needs memory to remember how I work. | 1 (memory) |

## Nice to have

Asked for 2026-10-25. Deferred until everything in **Next up** is done; a list, not an order.

| What | Why | Notes |
|---|---|---|
| Readable question dialogs | The dialogs that ask me things are hard to read. | Covers `ask_user`'s question and options, and the tool guard's permission dialog (`previewAsk`, several `folder-guard:` lines in a row). Revisit spacing, wrapping, and what stands out; compare Claude Code's. |
| A drill-in for running work | Claude Code shows "1 shell", and opening it shows what that shell is doing. Most useful for sub-agents. | MyPi's footer already shows `1 job`, but it can't be opened. The [subagents fleet view](modules/subagents.md#fleet-view) plans a collapsed line and an expanded runs list on the same `JobManager` list; build it so background shells get the same drill-in (output, state, stop). |
| Auto mode | Plan, Build, and Auto: a mode that runs without asking for each call, but not unchecked. | Research Claude Code's auto mode first (a classifier reviews each action instead of me; what it sees, what it blocks, how it's turned on), then decide how it fits [plan-build](modules/plan-build.md) and the [folder guard](rules/folder-guard.md). |

## Deferred

| What | Why | When to pick it up |
|---|---|---|
| ripwire | I install it myself later: the binary, then `skills/install.sh --codex` puts its skills in `~/.agents/skills/`, which pi reads. No MyPi code. See [ripwire](inspiration/ripwire.md). | Whenever I choose; then check it with analytics. |
| MCP-backed tools (code_search) | Need a server that offers them keyless. See [tools](tools/README.md#deferred). | When such a server exists. |
| SearXNG for web_search | Not installing it yet. See [web-search](tools/web-search.md). | If the hosted backends get unreliable. |

## Done

- Core: module loading (`/modules`), `PromptManager`, `ToolGuard` with "Allow for this session" and the writable list
  (`setWritable`), the shared footer and editor, `JobManager`, `keepOutOfGit`. See [architecture](architecture.md).
- [folder-guard](rules/folder-guard.md) slice 4: "Allow for this session" on a path allows everything under it, through
  an `onAllowSession` callback on the ask verdict. Slice 5: `/tmp` is allowed, and quoted patterns and tags no longer
  read as paths.
- [worktree](tools/worktree.md): `/worktree` enter, exit, list, and remove, with shared memories and plans, over a
  `Session.worktrees` service subagents can use.
- [identity](core/identity.md): every run tells the agent it's MyPi on pi, its model and running modules, and the
  paths to its own map, roadmap, and principles, so "improve yourself" works from any folder without searching.
- [plan-build](modules/plan-build.md), with Plan's shell check.
- [memory](modules/memory.md): project and global memories in the prompt, `/onboard`, `/memory-check`. Whether the
  agent saves on its own depends on the model; [analytics](modules/analytics.md) measures it before any nudge.
- [lsp](modules/lsp.md): TypeScript, Go, and Python servers started on first use, the `/lsp` menu, the `lsp` tool
  (outline, find_symbol, references, implementations, definition, diagnostics), and `lsp_edit` (rename).
- [done-check](modules/done-check.md): when a Build run is about to end, LSP errors in the files it changed and the
  project's approved commands from `.pi/done-check.json`, sent back for the agent to fix or explain. Built with
  MyPi's event bus (`src/core/events.ts`, `channels.ts`).
- [folder-guard](rules/folder-guard.md), the first core rule: asks before a tool's `path` or a bash command reaches
  outside the session's folder; lsp roots never go above it.
- Built-in tools: [web_search](tools/web-search.md), [web_fetch](tools/web-fetch.md),
  [background process](tools/background-process.md) (`bash` with `background: true`, `job_list`, `job_wait`, `job_stop`).
- [MCP server list](mcp/README.md): Parallel and Exa.

## How to choose

- Prefer what makes later work cheaper or better informed (memory, analytics) over what only adds a feature.
- Measure before steering: no hints or blocks that push the agent toward a tool until analytics shows it's worth it.
  See [analytics](modules/analytics.md#what-to-measure).
- Before calling a new tool done, run a self-evaluation prompt on it (Serena's method, same section).
- Run an outside tool before wrapping it: if it works from bash and skills, it needs no MyPi code (ripwire).
- New dependencies follow the rule in [AGENTS.md](../AGENTS.md#rules).
- Write down what was tried and rejected, in the doc of the thing it was for, so it isn't tried again blind. Example:
  tree-sitter for Plan's shell check, in [plan-build](modules/plan-build.md#plan-rule).
- Ideas from outside projects start in [inspiration](inspiration/README.md), then move into a module's or tool's doc
  once picked.
