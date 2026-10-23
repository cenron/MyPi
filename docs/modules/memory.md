# Memory

**Status:** idea (recorded 2026-10-22)

## Goal

Knowledge that lasts across sessions: what the agent learned about a project (how to build and test it, its
conventions, the gotchas already paid for) and how I like to work. Kept as plain Markdown files that I can read and
edit too. Pi only has context files (`AGENTS.md`, `CLAUDE.md`): one file per directory, always loaded whole. A module,
so it can be turned off.

## Where the idea comes from

- **Serena** ([inspiration](../inspiration/serena.md)): memories are Markdown files, per project
  (`.serena/memories/`, committed with the code) and global. The agent gets the list of names up front and reads the
  ones it needs; the harness never injects content. Topics come from `/` in names, memories link with `` `mem:name` ``
  (rewritten on rename, checked by a command), and patterns can mark memories read-only or hidden. A project with no
  memories gets an onboarding pass, seeded with a `memory_maintenance` memory that holds the conventions.
- **Claude Code's auto-memory**, which I use while pairing on MyPi: one fact per file with frontmatter (`name`,
  `description`, and a type: user, feedback, project, or reference), a `MEMORY.md` index with one line per memory
  loaded every session, and `[[name]]` links between memories.
- **ripwire** ([inspiration](../inspiration/ripwire.md)): notes pinned to a symbol, shown when a later lookup reaches
  it. Narrower; not planned here.

## What pi offers

Checked against the installed pi 1.2.0 (2026-10-22):

- **Context files only:** `AGENTS.md` / `CLAUDE.md` from the agent dir, the cwd, and its parents (pi's
  `docs/configuration.md` § Context files). No memory feature.
- **A prompt section:** MyPi's `PromptManager`, through `BaseModule.setPrompt`, is where the list goes.
- **No new tools needed to start:** pi's `read`, `write`, and `edit` work on any path.
- **Prompt templates:** a Markdown file in `resources/prompts/` becomes a `/` command named after the file, already
  declared in `package.json` under `pi.prompts`.

## Behavior

- **Two scopes:** project memories in `<cwd>/.pi/memories/`, global ones in a folder under `~/.pi/` (path open).
- **One memory per file**, `<topic>/<name>.md`, with frontmatter `name` and `description`.
- **The list, not the content:** the module's prompt section lists every memory as one line, its name and
  description. Serena gives names only; a description makes the right read likelier for a few tokens. The agent reads
  what looks relevant with `read`. The harness never puts memory content in the prompt (Serena's rule).
- **Conventions in the same section:** when to write one, one fact per file, update instead of duplicating, delete
  wrong ones, link related ones with `[[name]]`, and never secrets.
- **Writing:** the agent uses pi's own `write` and `edit`. Plan mode allows writes in the memory folders, like
  `.pi/plans/`.
- **`/onboard`:** a prompt template that has the agent learn a project (layout, build, tests, conventions) and write
  the first memories. It fills the context, so start a fresh session after.
- **Pair programmer:** how I like to work goes in global memories, which answers
  [pair-programmer](pair-programmer.md)'s "how does it remember how I like to work".

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/memory/` | Load type open. |
| The list | `init()` reads both folders and calls `setPrompt(section)` | A file with bad frontmatter is listed by its file name, not dropped. |
| Refresh | `tool_result` on `write` / `edit` under a memory folder, subscribed through `session.pi.on` in `init()` | The next request sees the new line. |
| Frontmatter | A small pure parser for `name:` and `description:` | Or `yaml`, which is in pi's dependency tree (allowed by the dependency rule in AGENTS.md). Open question. |
| Plan mode | plan-build's Plan rule allows the memory folders | Today it allows `.pi/plans/` only. |
| Onboarding | `resources/prompts/onboard.md` | No code. |

## Slices

1. Read both folders, parse frontmatter, and set the prompt section: the list and the conventions.
2. Refresh the list after the agent writes or edits a memory.
3. Plan rule: allow writes in the memory folders.
4. `/onboard` prompt template.
5. A link check: `[[name]]` links to memories that don't exist.

## Open questions

- Global folder: `~/.pi/memories/` or `~/.pi/agent/memories/`?
- Project memories: committed with the project (Serena), or git-ignored, since they can hold personal notes and some
  repos are public?
- Types like Claude Code (user, feedback, project, reference), free topics like Serena, or both?
- How long can the list get before the section shows topics only?
- Read-only memories (Serena's patterns): needed?
- Load type: `ON_LOAD` or `ON_DEMAND`?

## References

- Serena: `docs/02-usage/045_memories.md` (design rationale, onboarding, `memory_maintenance`)
- pi: `docs/configuration.md` § Context files, `docs/prompt-templates.md`
