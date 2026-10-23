# ripwire

**Source:** [redhat-et/ripwire](https://github.com/redhat-et/ripwire), read at `004b4c6` (2026-10-22, v0.6.8).
**License:** Apache 2.0.

## What it is

"The ripgrep of AI context": one C++ binary, no server, no embeddings, no key. It parses a repo with tree-sitter
(26 languages), builds a name-based call graph, ranks symbols with Personalized PageRank, and prints a deterministic,
compact XML map. Two jobs: **orient** before the agent reads (`ripwire . --for="<task>"`: the subsystems, entry
points, and symbols that matter for the task) and **check** what it wrote (`--edit-check=SYM`: did a contract change
and which callers break; `--quality-delta`: what got worse against a baseline; `--test-gate`, `--affected`: which
tests reach the change). ~190 flags, 17 task-shaped skills, an optional MCP server.

## What's worth taking

| Idea | How ripwire does it | For MyPi | Feeds |
|---|---|---|---|
| CLI first, MCP optional | "Its verb schemas sit in your agent's context every session, whether or not it calls them." A binary on `PATH` costs nothing until it runs; skills teach when to use it | A rule for every MyPi tool: is it worth its schema in every request? A narrow helper can be a skill over a shell command instead. pi's `deferred` MCP exposure and `tool_search` are the middle ground | [tools](../tools/README.md), [mcp](../mcp/README.md) |
| Skills by moment, plus a router | Each skill is named for a moment ("about to write one symbol", "reviewing my diff", "resuming after compaction"), and `ripwire-router` maps moment → skill in one table | How to write MyPi's skills in `resources/skills/`: by the moment, not by the feature | [project structure](../project-structure.md) |
| "One question, one complete answer" | Judged per complete answer across a task, not bytes per call: a short answer followed by three greps costs more | The yardstick for MyPi tool output (web_search, LSP, job output): enough to act on without a follow-up call | [tools](../tools/README.md) |
| Honest output | A zero means "none found", never "none exists"; every cut says what it dropped and how to get the rest (`next=`); counts that can't be totals are marked as floors; unsure answers are flagged | Same rules for MyPi tool results: say when output was cut and where the full text is (web_fetch and background jobs already save the full text), and never present a partial list as complete | [tools](../tools/README.md) |
| Budgets drop filler first | Under a token budget it drops repeated legend text and duplicate paths before answers, then the lowest-ranked rows, counted | For any MyPi tool that trims output | [tools](../tools/README.md) |
| Edit receipts | A write returns the edited region with context, the new file hash, the contract check, and the tests to run, so the agent never re-reads the file. Refuses on a stale hash or an ambiguous target; writes atomically (temp file, sync, rename) | apply_patch's result, and LSP symbol edits | [apply_patch](../tools/apply-patch.md), [lsp](../modules/lsp.md) |
| Check at "I think I'm done" | `--quality-delta` (only what got worse), `--edit-check`, `--test-gate` run when the agent is about to stop. Its field report credits this gate with a dozen real fixes across ~15 agents | MyPi has the moment already: `agent_settled`. A module could run checks (typecheck, LSP diagnostics, tests touched) there and send the agent back if something got worse | [lsp](../modules/lsp.md), new: done-check |
| Notes pinned to symbols | Agents leave gotcha notes on a symbol; later lookups show them | A narrower form of memory; worth comparing with Serena's memories | [serena](serena.md) |
| Measure whether advice works | A "substitution meter" logs every tool call to local JSONL; a randomized A/B (treatment/control by session hash) found its grep/read nudge hook had **no effect**, so it was retired. What replaced it fires earlier (on the prompt, before the first tool), pastes a ready command, and stays silent unless its classifier is confident | Two lessons: (1) don't build nudges without a way to measure them — the analytics module is that way; (2) a generic "use X instead" message does little, a ready-to-run suggestion at the right moment might | [analytics](../modules/analytics.md) |
| Keep negative results | The retired nudge's design is kept "because a measured negative whose reasoning is deleted gets rebuilt by the next person" | Keep "tried, didn't work, why" in the module or tool doc instead of deleting it | all docs |
| Self-contained prompts | `prompts/` holds orchestrator prompts (audit, onboarding a fresh agent, dogfood gaps) that write a plan and stop for a go-ahead | Ideas for `resources/prompts/` templates | [project structure](../project-structure.md) |
| Scan skills before install | `--scan-skills` checks skill files for dangerous content; a critical finding blocks | If MyPi ever installs third-party skills | — |

## Using ripwire itself

ripwire works from any agent that can run shell commands, so pi can use it today with no MyPi code: install the
binary and its skills. If it proves useful, a later step is a MyPi skill or a thin tool over the CLI. The LSP module
and ripwire overlap (callers, references) but differ: LSP is exact and per-language with a server running; ripwire
is fast, offline, cross-language, and ranks by task.

## Not for MyPi

- **The ranking engine.** PageRank over a tree-sitter graph is the binary's job; MyPi would call it, not rebuild it.
- **Its MCP server's 33 verbs as defaults.** Against its own advice, and the schema cost is real.
- **Per-agent install wiring (`ripwire wrap`).** pi isn't one of its listed agents; skills work as they are.

## References

- README: "The goal: one question, one complete answer", "The honesty contract", "Set it up in your coding agent"
- Router skill: `skills/ripwire-router/SKILL.md`
- Retired nudge and the A/B: `hooks/ripwire-nudge.sh` §RETIRED, `docs/SUBSTITUTION_METER.md`, `docs/EVALS.md` §4
- Prompt router: `hooks/ripwire-claude-route.sh`, `hooks/ripwire-claude-toolroute.sh`
