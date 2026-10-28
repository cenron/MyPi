# Roadmap

What to build next, and why. Asked "what should we build next?", start from **Next up**: the first row that isn't
done, unless something below says otherwise. When something moves, update its status in its own doc and its row
here; when the order changes, say why in the row.

## Next up

Proposed order, agreed 2026-10-22; subagents moved above analytics and worktree above subagents 2026-10-23; folder-guard added after lsp 2026-10-24; folder-guard slice 4 and identity added before worktree 2026-10-25; plan-build slice 9 added after worktree 2026-10-25; context B–D added and subagents made foundational 2026-10-25; self-build fixes and todo moved before subagents milestone 2, which tests them, 2026-10-26; the duplicate check added after milestone 2, splitting subagents milestones 2 and 3, 2026-10-26. Change it freely.

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
| 13 | [subagents](modules/subagents.md#slices) milestone 2 | module | **Done 2026-10-26:** `/jobs` lists every job and opens/stops them; up to three writers work in separate temporary worktrees and return patches for approval. Outside git, one writer runs in place. **Milestone 2 was the test bed for 11 and 12** (the user's call, 2026-10-26): built by pi on gpt-6-luna at **high** thinking, with the same Observations log per checkpoint plus the data to compare with milestone 1. | 7 (worktree) and its discard step; 11, 12 |
| 14 | Duplicate check | done-check module, reviewer agent | **Done 2026-10-26.** At the end of a Build run, the [done check](modules/done-check.md#slices) asks LSP for new top-level declarations in changed files that already exist by exact name elsewhere. It excludes test files, checks only Git projects, reports each name once per session (up to 10 per report), and continues the run as it does for errors and open tasks. The reviewer also searches new helpers by name and behavior. MyPi only; no ripwire. A name lookup misses renamed copies. | 13 |
| 15 | [subagents](modules/subagents.md#slices) milestone 3 | module | **Done 2026-10-26:** creating agents (`agent_manage` and `/agents`). **Turn ripwire's skills back on for pi first** (remove `"!**/ripwire-*"` from `skills` in `~/.pi/agent/settings.json`; hidden for milestone 2, the user's call 2026-10-26) and measure what its own skills do, with no nudge or MyPi code around them: rebuilt-instead-of-reused count, `lsp` share, and how often pi calls `ripwire`, against milestone 2's. | 13 |
| 16 | Cleanup from the ripwire pass | ui, core, modules | **Done 2026-10-26.** Behavior-neutral fixes the full ripwire pass after milestone 3 found and the reviews missed (`.pi/plans/2026-10-26-milestone-3-post-mortem.md`, git-ignored): shared dialog lists, a `ChildRun` object, writer accounting, done-check duplicate filtering, and tests for `/worktree list`/`remove` and `/agents` wiring. | 15 |
| 17 | [analytics](modules/analytics.md) | module | **Milestone 1 done 2026-10-27:** a local SQLite index of pi's session files, and `/analytics` sections for model usage, tools and failures, shell commands with no tool, code navigation per model, MyPi's features (done check, todo, subagent runs with child cost), and permission dialogs per model, rule, and choice. The handwritten `measure-tool-use.py` is retired: the report matched it on the same sessions. Next: milestone 2 benchmarks use a coding and MyPi-features track through pi RPC, 3 runs per task. Built by alternating GPT-6 Luna and DeepSeek V4.1 Flash, Qwen 3.8 Max once, to compare them on real work. | `node:sqlite` (built in); sub-agent runs (10) |
| 18 | [apply_patch](tools/apply-patch.md) | tool | Must-have built-in: multi-file edits for GPT models, with edit receipts. | Nothing |
| 19 | [notifications](modules/notifications.md) | module | Small; most useful once runs get longer. | Nothing |
| 20 | [pair-programmer](modules/pair-programmer.md) | module | The mode MyPi was started for, but it needs memory to remember how I work. | 1 (memory) |
| 21 | [quiet](modules/quiet.md) | module | **Done 2026-10-27.** Compact tool-call status lines, failures kept open, and a `QUIET` footer label; the first piece of the theme picker. Chose two-line rows because pi 1.4.0 always adds a spacer outside the renderer. | pi 1.4.0 renderer resolver |
| 22 | Writer worktrees get the active plan | subagents module | Found 2026-10-28 in job-search-hub: Build handed a plan step to `general` writers, but `.pi/plans/` is git-ignored and a writer's worktree starts at committed HEAD, so the plan file named in the task wasn't there. The writer said so and did only part of the job; the patch was declined. Fix: copy the active plan file into the writer's worktree, or put the plan's text in the writer's task, and say which in the task. Small, and every delegated Build step depends on it. | 13 (subagents milestone 2) |

## Nice to have

Asked for 2026-10-25. Deferred until everything in **Next up** is done; a list, not an order.

| What | Why | Notes |
|---|---|---|
| Readable question dialogs | The dialogs that ask me things are hard to read. | Covers `ask_user`'s question and options, and the tool guard's permission dialog (`previewAsk`, several `folder-guard:` lines in a row). Revisit spacing, wrapping, and what stands out; compare Claude Code's. |
| A drill-in for running work | Claude Code shows "1 shell", and opening it shows what that shell is doing. Most useful for sub-agents. | **Done 2026-10-26:** `/jobs` opens any session job's output and can stop running jobs; the below-editor line shows running jobs. |
| Auto mode | Plan, Build, and Auto: a mode that runs without asking for each call, but not unchecked. | Research Claude Code's auto mode first (a classifier reviews each action instead of me; what it sees, what it blocks, how it's turned on), then decide how it fits [plan-build](modules/plan-build.md) and the [folder guard](rules/folder-guard.md). |
| Theme picker | Switch how pi looks from a menu: themes of colors **and** layout, each its own module, added or removed freely. | Asked for 2026-10-26. A first theme in Claude Code's look (the `❯` prompt line, dots and connectors on tool rows, grouped calls, collapsed thinking, diffs on edits; see [pi-cc-tools](inspiration/pi-cc-tools.md)); Codex or Gemini themes later if wanted. Quiet is its first piece: compact tool-call status lines and the `QUIET` footer label. pi 1.2.0's seams cover most of it: `registerToolRenderer` restyles any tool without owning it, plus `setFooter`, `setHeader`, `setEditorComponent`, `setWorkingIndicator`, `setWidget`, and `setTheme`. Following the terminal's colors needs pi 1.4. |
| A clearer footer | pi's footer shows cache use as `R39M CH99.6%`, which is hard to read, and nothing says when the cache will expire. | Asked for 2026-10-26. Likely a rebuild of the footer, so show useful details: cache use in plain words, and a countdown to when the cache expires (it's why cost jumps after a pause or a compaction: cache hits fell from 99% to 21% after one in subagents milestone 3). Fits the theme picker's layouts. |

| Spend fewer tokens, measured | A session's cost is mostly what's re-sent every request: cache reads are 67% of GPT-6 Luna's cost, cache writes 60% of Qwen 3.8 Max's, and output 44% of DeepSeek V4.1 Flash's (MyPi's sessions, 2026-10-26). | Asked for 2026-10-26, from research on cutting tokens ("caveman" prompts were dropped: blog-measured only, and they shrink output, a small part of the bill). Four ideas with published evidence, each tried one at a time and kept only if `/analytics` shows it helped: **clear old tool results sooner** (context piece E exists; Anthropic's context editing measured −84% tokens on a 100-turn task), **cheaper models for routine agents** (FrugalGPT: GPT-4's results at up to 98% less cost; `explore` costs about 12× less on DeepSeek than on Qwen), **one "don't narrate between tool calls" line** (Concise Chain-of-Thought: −49% response length with little accuracy loss; aimed at DeepSeek's narration), and **a smaller, steadier prompt prefix** (prompt sections and tool definitions, and fewer cache restarts such as Plan/Build switches). |
| Session retention | pi keeps every session file forever (no retention policy, checked 2026-10-26); they grow about 30 MB a week while building MyPi. | Asked for 2026-10-26; explore later. A small module that moves sessions older than N days to the Trash (as pi's `/resume` delete does), turned off by default. **Analytics first:** today deleting a session file also drops its rows from the analytics index, so a cleanup would erase history; analytics should keep a file's counts once its source is gone (they're only numbers). |

## Future discussions

Ideas from [inspiration](inspiration/README.md) that don't fold cleanly into the roadmap and aren't needed for it
(the user's rule, 2026-10-26: inspiration is built into MyPi, never installed, and is post-MVP). To talk about once
**Next up** is done; each notes where it would fit.

| Idea | From | Would fit |
|---|---|---|
| Workflows: agents in a chain, each step's output the next one's input (`$INPUT`, `$ORIGINAL`) | [pi-vs-claude-code](inspiration/pi-vs-claude-code.md), pi-subagents | [subagents](modules/subagents.md), after milestone 3 |
| Teams: named groups of agents, and a dispatcher that only delegates | pi-vs-claude-code | subagents milestone 3 (creating agents) |
| Per-area expert agents for improving MyPi itself (extensions, TUI, themes…), each pointed at the right pi docs | pi-vs-claude-code (`pi-pi`) | subagents milestone 3, with [identity](core/identity.md) |
| Load Claude Code's agent files (`.claude/agents/*.md`) as MyPi agents | pi-vs-claude-code (`cross-agent`) | subagents' agent loader |
| Peer-to-peer messaging between agents (list, send, get, await; a hop limit) | pi-vs-claude-code (`coms`) | subagents' [external agents](modules/subagents.md#external-agents-later) |
| Protected paths inside the project: no access (`.env`, keys) and no delete (`.git/`) | pi-vs-claude-code (`damage-control`) | [folder guard](rules/folder-guard.md) |
| A live tool tally, such as the code-navigation mix | pi-vs-claude-code (`tool-counter`) | [analytics](modules/analytics.md)' summary |
| A timeline of the session | pi-vs-claude-code (`session-replay`) | — (pi's `/tree` covers navigation) |

## Deferred

| What | Why | When to pick it up |
|---|---|---|
| ripwire | Installed 2026-10-26 (the binary and its skills in `~/.agents/skills/`, which pi reads). No MyPi code around it and no nudge toward it: not every system has it. See [ripwire](inspiration/ripwire.md), with a first test on MyPi. | Its skills are hidden from pi for subagents milestone 2 and turned back on for milestone 3 (row 15), to measure them alone. |
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
  MyPi's event bus (`src/core/events.ts`, `channels.ts`). Also reports new names that already exist elsewhere (the
  duplicate check, row 14).
- [subagents](modules/subagents.md), milestones 1–3: `subagent` runs `explore`, `general`, `architect`, `developer`,
  `reviewer`, and the user's own agents in child sessions, in the background as jobs; up to three writers in their own
  worktrees return patches applied with `subagent_apply`; `/jobs` lists every job; `agent_manage` and `/agents`
  create, edit, and delete agents. Later: fork context, steering a running child, and external agents.
- [context](modules/context.md), pieces A–E: the plan file named in Build's section, steered compaction summaries,
  and old tool results cleared.
- [todo](modules/todo.md): Claude Code's task tools, the checklist above the editor, and a reminder after quiet
  requests.
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
