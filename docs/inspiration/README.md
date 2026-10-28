# Inspiration

Other projects worth learning from: what they do, which ideas fit MyPi, and which don't. **Inspiration only:** MyPi
never installs these; their ideas are built into MyPi. They're post-MVP: an idea goes into a current plan only when it
makes a roadmap item better and fits cleanly, or is an obvious improvement; otherwise it waits under
[Future discussions](../roadmap.md#future-discussions). One doc per project, named
after it. Each doc says which commit was read and its license, and links the MyPi docs it feeds. When an idea is
picked up, its design goes in that module's or tool's doc, not here.

| Project | Read | Summary | Feeds |
|---|---|---|---|
| [Serena](serena.md) | 2026-10-22 | MCP server with symbol-level code tools over language servers, plus Markdown memories and modes | [lsp](../modules/lsp.md), [plan-build](../modules/plan-build.md), [analytics](../modules/analytics.md), [memory](../modules/memory.md), [done-check](../modules/done-check.md) |
| [pi-subagents](pi-subagents.md) | 2026-10-22 | A pi package that runs child agents as pi sessions through pi's SDK, with agent files, workflows, and a fleet view | [subagents](../modules/subagents.md) |
| [ripwire](ripwire.md) | 2026-10-22 | One binary that maps a repo by ranked call graph before the agent reads, and checks what it wrote | [tools](../tools/README.md), [lsp](../modules/lsp.md), [analytics](../modules/analytics.md), [apply_patch](../tools/apply-patch.md), [done-check](../modules/done-check.md), [roadmap](../roadmap.md) |
| [pi-cc-tools](pi-cc-tools.md) | 2026-10-26 | A pi package that makes pi look like Claude Code: grouped tool rows, highlighted diffs, a naming spinner, terminal colors | [roadmap](../roadmap.md#nice-to-have) (themes: colors and layouts) |
| [pi-vs-claude-code](pi-vs-claude-code.md) | 2026-10-26 | A playground of pi extensions: agent chains and teams, agent-to-agent messaging, safety rule files, loading Claude Code's agents and skills | [subagents](../modules/subagents.md), [folder-guard](../rules/folder-guard.md), [analytics](../modules/analytics.md) |
| [pairing-buddy](pairing-buddy.md) | 2026-10-27 | A pair programmer for Neovim that speaks rarely: a fast model scores each moment, three roles with tools enforced in code, triggers from your terminals through herdr | [pair-programmer](../modules/pair-programmer.md), [notifications](../modules/notifications.md), [done-check](../modules/done-check.md), [memory](../modules/memory.md), [analytics](../modules/analytics.md) |

## Where the ideas went

Picked 2026-10-22; the order to build them is in the [roadmap](../roadmap.md).

| Idea | From | Now in |
|---|---|---|
| A memory module: Markdown files, the list in the prompt, read on purpose, `/onboard` | Serena, ripwire's notes | [memory](../modules/memory.md) |
| A check when the agent says it's done, reporting only what got worse | ripwire, Serena | [done-check](../modules/done-check.md) |
| Symbol tools by name path; diagnostics at the end of a turn, not per edit | Serena | [lsp](../modules/lsp.md) |
| Honest output: say what was cut and how to get it; "none found", not "none exist"; one call answers | ripwire | [tools](../tools/README.md#rules-for-every-built-in-tool) |
| Edit receipts and atomic writes | ripwire | [apply_patch](../tools/apply-patch.md) |
| Measure before steering the agent; a self-evaluation prompt per new tool | ripwire, Serena | [analytics](../modules/analytics.md#what-to-measure) |
| Run an outside tool before wrapping it | ripwire | [roadmap](../roadmap.md) (ripwire is deferred: I install it myself) |
| Write down what was tried and rejected | ripwire | [roadmap](../roadmap.md#how-to-choose) |
| Children as pi SDK sessions; agents as Markdown; read-only roles; no nesting; evidence in the result | pi-subagents | [subagents](../modules/subagents.md) |
| External agents (Claude Code, Codex) interactive in herdr panes, later; a fleet view that also creates agents | Radian, pi-subagents | [subagents](../modules/subagents.md) |
