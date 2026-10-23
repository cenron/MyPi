# Inspiration

Other projects worth learning from: what they do, which ideas fit MyPi, and which don't. One doc per project, named
after it. Each doc says which commit was read and its license, and links the MyPi docs it feeds. When an idea is
picked up, its design goes in that module's or tool's doc, not here.

| Project | Read | Summary | Feeds |
|---|---|---|---|
| [Serena](serena.md) | 2026-10-22 | MCP server with symbol-level code tools over language servers, plus Markdown memories and modes | [lsp](../modules/lsp.md), [plan-build](../modules/plan-build.md), [analytics](../modules/analytics.md), a memory module |
| [ripwire](ripwire.md) | 2026-10-22 | One binary that maps a repo by ranked call graph before the agent reads, and checks what it wrote | [tools](../tools/README.md), [lsp](../modules/lsp.md), [analytics](../modules/analytics.md), [apply_patch](../tools/apply-patch.md), skills |

## Ideas across projects

- **A memory module** (Serena memories, ripwire's pinned notes): plain Markdown files, a list of names up front, read
  on purpose.
- **A done-check** (ripwire's `--quality-delta` gate, Serena's diagnostics diff): on `agent_settled`, report only
  what got worse since the turn started.
- **Measure before nudging** (ripwire's A/B, Serena's grep/read hook): steering the agent toward a tool needs the
  analytics module first, to show it helps.
