# Memory

**Status:** done (design agreed and slices 1–5 built 2026-10-23; #1 on the [roadmap](../roadmap.md))

## Goal

Knowledge that lasts across sessions: what the agent learned about a project (how to build and test it, its
conventions, the gotchas already paid for) and how I like to work. Kept as plain Markdown files that I can read and
edit too. Pi only has context files (`AGENTS.md`, `CLAUDE.md`): one file per directory, always loaded whole.

A foundational module, `ALWAYS` like plan-build: every session gets it. It's a module, not core, so it can be replaced
by a better memory system without the rest of MyPi noticing (see [Decisions](#decisions-2026-10-23), 7).

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

Checked against the installed pi 1.2.0 (2026-10-22, 2026-10-23):

- **Context files only:** `AGENTS.md` / `CLAUDE.md` from the agent dir, the cwd, and its parents (pi's
  `docs/configuration.md` § Context files). No memory feature.
- **The agent dir:** `getAgentDir()`, exported by pi, is `~/.pi/agent` unless `PI_CODING_AGENT_DIR` moves it
  (`dist/config.js`). Pi keeps every user-level folder there (`prompts/`, `themes/`, `sessions/`).
- **A frontmatter parser:** `parseFrontmatter` (`dist/utils/frontmatter.js`, exported), full YAML through `yaml`,
  returning `{ frontmatter, body }`. Pi uses it for skills and prompt templates. It throws on invalid YAML.
- **A prompt section:** MyPi's `PromptManager`, through `BaseModule.setPrompt`, is where the list goes.
- **No new tools needed to start:** pi's `read`, `write`, and `edit` work on any path. `write` and `edit` write in place
  with `fs.writeFile` (`dist/core/tools/write.js`, `edit.js`), so a file without write permission fails with `EACCES`.
- **Sending a prompt from a command:** `pi.sendUserMessage()`.

## Decisions (2026-10-23)

1. **Global folder: `<agent-dir>/memories/`,** found with `join(getAgentDir(), "memories")`. It pairs with the
   project's `.pi/memories/` the way pi pairs `<agent-dir>/prompts/` with `.pi/prompts/`, and it follows
   `PI_CODING_AGENT_DIR`, so a sandbox agent dir gets its own memories. `~/.pi/memories/` was rejected: a second rule
   for where user-level files live.
2. **Project memories are git-ignored,** through a `.gitignore` of `*` inside `.pi/memories/`, the same mechanism as
   `.pi/plans/`. The agent writes memories without review and some repos are public, so private is the default. The
   refresh hook (slice 2) creates the file with `wx` when a write lands in the folder, never overwriting it: to share a
   project's memories, edit that `.gitignore`. `init()` doesn't create it, since that would create `.pi/memories/` in
   every folder pi opens. Committed (Serena) and outside the repo (Claude Code's per-project folder) were rejected.
   For [worktree](../tools/worktree.md): ignored memories aren't in a new worktree, so it has to copy them in.
3. **Free topics, not types.** A memory is `[<topic>/]<name>.md`; the topic folder is optional. Its name is its path
   in the scope folder without `.md` (`build/test-commands`), and `[[build/test-commands]]` links use it. The only
   frontmatter field is `description:`; a `name:` field would repeat the path and drift on a rename. Claude Code's
   types mostly repeat the two scopes (user and feedback are global, project is project), so what's worth keeping
   from them moves into the conventions instead of a `type:` field.
4. **No limit on the list** for now. Every memory gets its line; nothing is ever dropped silently (Claude Code cuts
   `MEMORY.md` at 200 lines). Revisit when one scope passes about 100 lines (~3k tokens), with
   [analytics](analytics.md) showing whether listed memories get read: then collapse that scope to topic names and
   counts, and the agent lists a topic's folder.
5. **Read-only means file permissions:** `chmod a-w` on the file. `write` and `edit` fail with `EACCES`, and the
   conventions say a memory the agent can't write is read-only, not to work around. No code. A `readonly:` field
   enforced by a `ToolGuard` rule was rejected for now: it stops no more than permissions do (neither stops `rm` in
   `bash`). Build it if the agent works around permissions.
6. **Load type: `ALWAYS`.** Memory is foundational, like plan-build.
7. **Replaceable.** Nothing imports `#module/memory`, and no other module's prompt names memory's folders or format:
   they say "save a memory", and only memory's own prompt section says how. Memory only plugs into core seams
   (`PromptManager`, a `tool_result` hook, the writable list in `ToolGuard`), so a different system (SQLite, a vector
   index) replaces this module and nothing else changes. The same goes the other way: memory never imports
   plan-build, so either can be turned off, changed to another load type, or replaced without breaking the other. If
   another part ever needs memory in code, that goes through a core seam, not an import. Existing memories would need
   a one-time import. The likeliest next step keeps the Markdown files as the source of truth and adds a search index
   over them.
8. **No project-trust check,** like pi. Pi loads a project's `.pi/` resources only once the folder is trusted
   (`ctx.isProjectTrusted()`), but it loads `AGENTS.md` and `CLAUDE.md` whatever the decision (pi's
   `docs/security.md` § Project trust). Memory reads `.pi/memories/` the same way: a cloned repo with committed
   memories puts their descriptions in the prompt. Gating the project scope was rejected: one-line descriptions are a
   smaller channel than the context files pi already loads untrusted, project memories are git-ignored by default, and
   it would be a rule pi doesn't have. Revisit if pi starts gating context files.

## Behavior

- **Two scopes:** project memories in `<cwd>/.pi/memories/` (git-ignored), global ones in `<agent-dir>/memories/`.
- **One memory per file**, named by its path, with frontmatter `description:`.
- **The list, not the content:** the module's prompt section lists every memory as one line, by scope: its path and
  description. Serena gives names only; a description makes the right read likelier for a few tokens. The agent reads
  what looks relevant with `read`. The harness never puts memory content in the prompt (Serena's rule).
- **Conventions in the same section:**
  - Memories can be out of date: check one against the code before relying on it; fix or delete it if wrong.
  - When to write one: only what a future session needs and can't get from the code, git history, or `AGENTS.md`;
    not details of the current task. Where: how I work goes global, facts about the project go in the project.
  - One fact per file. A correction or preference says why and how to apply it.
  - Use an existing topic before making a new one. The description is one short line.
  - Update instead of duplicating, delete wrong ones, link related ones with `[[path]]`.
  - Never secrets.
  - A memory the agent can't write is read-only: leave it, don't work around it.
- **Writing:** the agent uses pi's own `write` and `edit`. Plan mode allows writes in the memory folders, like
  `.pi/plans/`, through a list in core that both modules add to.
- **`/onboard`:** has the agent learn a project (layout, build, tests, conventions) and write the first memories. It
  fills the context, so start a fresh session after.
- **Pair programmer:** how I like to work goes in global memories, which answers
  [pair-programmer](pair-programmer.md)'s "how does it remember how I like to work". Its prompt says "save a memory",
  never where (decision 7).

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/memory/` | `ALWAYS`. |
| The list | `init()` reads both folders and calls `setPrompt(section)` | Sync reads (`readdirSync` with `recursive`, `readFileSync`): `ModuleManager.init()` doesn't await `init()`, so an async read could miss the first prompt. A file with no `description:` is listed by its path alone, not dropped. A missing folder is an empty scope; any other read error warns through `session.logWarning` (check permissions, then `/reload`) and lists that scope as unreadable, so the modules after memory still start. Empty scopes still get the conventions and their folder, so the agent knows where to write the first memory. Tests set `PI_CODING_AGENT_DIR` to a missing path in `vitest.config.ts`, so they never read real global memories. |
| Refresh | `tool_result` on `write` / `edit` under a memory folder, subscribed through `session.pi.on` in `init()` | The next run (my next prompt) sees the new line: prompt sections apply at `before_agent_start`, once per run (`mypi.ts`), not on each request inside a run. Also creates the project folder's `.gitignore` with `keepOutOfGit` (`#core/util/git`, shared with plan-build); if that fails, it warns that project memories may be committed and still refreshes. Paths resolve with `resolveToolPath` against the call's cwd, like Plan's rule; the two folders are fields set when the module is built, since pi builds new modules on every `session_start`. `rm` in `bash` and hand edits show after `/reload` (agreed 2026-10-23: re-reading on every run would need a core change for one user). |
| Link check | `linksIn` (pure, `links.ts`) on each file's whole text, so links survive invalid YAML; `memoryNames` across both scopes; `brokenLinks` flags them in the list and `checkReport` (in `commands/memory-check.ts`) for `/memory-check` | One rule, two outputs: the list for the agent, the command for me. |
| Frontmatter | pi's `parseFrontmatter` | A non-string or missing `description` is no description. Invalid YAML (an unquoted `: ` is enough) is caught and listed as `(frontmatter isn't valid YAML; fix it)` instead of a description, so the agent sees and fixes it; the conventions say to quote a description with a colon. Slice 1 first shipped its own one-line parser, made without checking pi's exports; replaced the same day. |
| Plan mode | `BaseModule.setWritable({ dirs, tools })`: a list in core (`ToolGuard`) of folders and tools a read-only mode may still write, merged into the rules' `env` (`writableDirs`, `writableTools`) on each call | Plan's rule used to hard-code `.pi/plans/` and `submit_plan`. Now plan-build adds those two and memory adds its folders; Plan's rule reads the list and never knows who added what. Tool names are in it so a memory system that saves through its own tool can add that tool. Any module on or off works: with memory off, Plan allows only plans; with plan-build off, nobody reads memory's entries. `PLAN_PROMPT` says "what other sections say plan mode allows", and memory's conventions say saving memories is allowed in plan mode, so neither prompt names the other module. |
| Onboarding | A module command (`commands/onboard.ts`) that waits with `ctx.waitForIdle()`, then sends `ONBOARD_PROMPT` (`prompt.ts`) with `pi.sendUserMessage()`. The prompt names dependency and build folders for several languages to skip (`node_modules`, `vendor`, `.venv`, `target`, `bin`/`obj`, …) and points at `git ls-files` and `rg --files`, which skip what `.gitignore` ignores and are on Plan's read-only list; the first live run crawled `node_modules` with `find`. | Not a template in `resources/prompts/`: those load whether or not the module does, so the prompt goes with the module (decision 7). |

## Slices

1. **Done.** Read both folders, parse `description:`, and set the prompt section: the list and the conventions
   (`src/module/memory/`: `folders.ts` reads, with pi's `parseFrontmatter`; `prompt.ts` is pure; `types.ts`).
2. **Done.** Refresh the list after the agent writes or edits a memory, and create the project `.gitignore`
   (`onToolResult` in `index.ts`; `keepOutOfGit` moved to `src/core/util/git.ts`).
3. **Done.** The writable list in core: plan-build adds `.pi/plans/` and `submit_plan`, memory adds both folders, and
   Plan's rule uses it. `PLAN_PROMPT` allows "what other sections say plan mode allows", and memory's conventions say
   saving memories is allowed in plan mode, so neither prompt names the other module.
4. **Done.** `/onboard`, in the current session (agreed 2026-10-23; a new session like `/plan implement` was more code
   for a command usually run at the start of one). The prompt reads existing memories and `AGENTS.md` first and updates
   rather than repeats, so it doubles as a refresh; it reads build and test commands instead of running them (slow, side
   effects, and every one asks in Plan). `pi.sendUserMessage` returns nothing and reports its own errors, so the
   command doesn't catch.
5. **Done.** A link check, two ways (agreed 2026-10-23): the list flags a memory whose `[[name]]` links point at no
   memory in either scope, `(broken links: [[x]])`, so the agent fixes it on its next prompt; and `/memory-check`
   reads both folders when run and reports every flag by file (unreadable folders, invalid frontmatter, broken links),
   for when I want to look myself. A link is `[[name]]` with no whitespace inside, so bash's `[[ -f x ]]` isn't one
   (`links.ts`; the report is `checkReport` in `commands/memory-check.ts`).

## Saving without being asked

Live tests on 2026-10-23, in an empty folder in pi, acting as a user who asks for a todo app and states a preference
in passing (a test persona, not my real preferences):

| Run | Model | Conventions | Result |
|---|---|---|---|
| 1 | gpt-6.1-sol | Without the trigger line | Saved the stated preference as a global memory during planning, unasked. Missed a gotcha it worked around (a missing tool). |
| 2 | gpt-6-luna | With the trigger line ("When the user corrects you or states a preference, or you work around a problem … save it before you finish.") | Saved nothing: not the preference, not the gotcha (the same missing tool). |
| 3 | gpt-6-luna | Trigger line, plus a temporary end-of-run nudge | The nudge ("did this task teach you anything a future session would need … save it now") fired once after the build, and the model saved the preference at once. |

Saving on its own depends on the model; the trigger line stays, but isn't enough by itself. The nudge was removed
after the test: measure first ([analytics](analytics.md#measuring-what-mypi-adds) counts runs that changed files
without a memory save). How it worked, if it comes back: on `before_agent_start`, reset two flags and mark a run whose
prompt is the nudge itself; on `tool_result`, a successful `write`/`edit` in a memory folder is a save and one outside
`.pi/` is work; on `agent_settled`, send the nudge with `pi.sendUserMessage` when the run did work, saved nothing, and
wasn't the nudge's own run. A plan-only run writes only `.pi/plans/`, so it never nudges.

Also seen: in Build mode the agent piped a pnpm installer into `sh` (installing to `~/Library/pnpm` and editing
`~/.bashrc`) when pnpm was missing. That's Build's full access working as designed, not a memory issue.

## Not taking

- **Serena's link rewrite on rename.** The agent renames by hand; the broken-link flag shows what to fix on the next
  prompt, with no rename tracking.
- **Serena's hidden memories** and a `readonly:` field: see decision 5.
- **Types** (Claude Code's user, feedback, project, reference): see decision 3.

## References

- Serena: `docs/02-usage/045_memories.md` (design rationale, onboarding, `memory_maintenance`)
- pi: `docs/configuration.md` § Context files, `docs/prompt-templates.md`
