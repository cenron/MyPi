# Folder guard

**Status:** building (slice 1 done 2026-10-24)

A built-in rule, not a module: it's always on, in every session (decided 2026-10-24). The code is
`src/rule/folder.ts`.

## Goal

Ask before any tool call reaches outside the session's folder. In a live test (2026-10-24), pi started in
`~/Documents/workspace/pi-workspace` ran `find .. -name AGENTS.md`, then `find /Users/radni/Documents -maxdepth 5 …`
and `find /Users/radni -maxdepth 5 …` looking for an existing "todo" project. Nothing stopped it: Build runs any
command, and Plan's rule lets `find` and `ls` run anywhere because they only read. Reading is still looking, and the
user's other projects and personal files are none of the agent's business unless the user says so.

## Behavior

- **Ask, in both modes.** A call that names a path outside the session's folder opens the permission dialog: Yes, No,
  or "Allow for this session". No UI means a block, with the reason.
- **Outside** means the path, resolved the way pi resolves tool paths (`resolveToolPath`), isn't inside `ctx.cwd`
  (`isInside`). It compares text, so a symlink inside the folder that points elsewhere counts as inside.
- **The question names the place, not the command:** `Reaches outside <cwd>: <path>`, one line per outside path. The
  guard's "Allow for this session" remembers exact lines, so allowing a path once lets every later call that reaches
  that same path run unasked until `/reload`, whatever the command. A parent isn't allowed by allowing a child, or the
  other way round.
- **Always allowed**, so pi's own work doesn't prompt:
  - the folders modules already declare as theirs (`BaseModule.setWritable`), such as memory's global folder;
  - the skills and context files pi put in the last prompt: each skill's folder (`baseDir`) and each `AGENTS.md` pi
    loaded, read from `before_agent_start`'s `systemPromptOptions`. That's exactly what pi points the agent at,
    wherever it lives (the agent dir, `~/.agents/skills`, a package such as MyPi's `resources/skills`, a project's
    parents), with no folder list to keep in step;
  - the temp folder (`os.tmpdir()`), where background jobs and `web_fetch` write their output. On macOS that's
    `/var/folders/…/T`, not `/tmp`, so `/tmp` asks;
  - `/dev/null` and the other `/dev/std*` streams.

  Not the whole agent dir: it holds `auth.json`.
- **pi's opening `AGENTS.md` lookup prompts** (decided 2026-10-24). pi already loads `AGENTS.md` from the session
  folder and its parents into the prompt itself (pi's `docs/configuration.md` § Context files), so the model's own
  `find ..` repeats that work; one "Allow for this session" covers it for the session.

## Which calls it checks

| Tool | Paths checked |
|---|---|
| Any tool with a string `path` input (`read`, `edit`, `write`, `grep`, `find`, `ls`, `lsp`, and later ones), except MCP tools (`mcp__…`) | `path`; none means the session's folder |
| `bash` | Every word that reads as a path: starts with `/` or `~`, is `..` or starts with `../`, or holds `/../`. A `--flag=value` word is checked by its value. Words holding `://` are URLs, not paths. |
| MCP tools, `web_search`, `web_fetch` | Nothing: they don't take local paths. |

- **Words come from `tokenize`** (`src/core/util/shell.ts`, Plan's shell check), so quotes are removed and comma
  braces expanded. When `tokenize` gives up (`$(…)`, variables, and so on), the raw command is scanned for the same
  path shapes instead, plus `$HOME` and `${HOME}`.
- **`cd` counts:** `cd /elsewhere && ls` names `/elsewhere`.

## What it isn't

A guard against wandering, not a sandbox. It sees the paths a call names, not the ones a program computes while it
runs: a script that reads `~/.ssh` without naming it on the command line gets through, as does a variable set
earlier in the session. Real isolation is an OS sandbox's job; see [Not taking](#not-taking).

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Rule | `FolderRule` in `src/rule/folder.ts`, a `BaseRule`; `registerRules` (`src/rule/index.ts`) sets it on the guard when `MyPi` starts a session | `info.name` is `folder-guard`, the prefix of its questions. The tool guard merges its ask with Plan's into one dialog, and a block from any rule still wins. |
| Allowed places | `ToolEnv` and the shared `PromptPaths` | `env.writableDirs` carries every module's `setWritable` folders. The prompt's skill folders and context files are `this.prompt.paths`, the session's one `PromptPaths`, which `updatePromptPaths` (`src/rule/index.ts`) fills from the first run's prompt. The rule adds the temp folder and the `/dev` streams itself. |
| Path words in bash | `tokenize`, then a regex fallback | In `src/rule/` unless a second part needs it. |

## The lsp module

The guard checks `lsp`'s `path` like any tool's. The module itself also reaches upward on its own: it looks for root
markers (`package.json`, `go.mod`, …) in the folders above a file, and a marker found above the session's folder would
make that folder the server's root and the disk check's scan. So, for a file inside the session's folder, lsp never
roots a server above it: a marker above clamps the root to the session's folder. The servers' own lookups (TypeScript
finding a `tsconfig.json` above, say) are theirs and unchanged. See [lsp](../modules/lsp.md#behavior).

## Slices

1. **Done 2026-10-24.** The rule for tools with a `path` input (`FolderRule`), with the always-allowed places. Built
   as a module first, then moved to core the same day: a guard that can be turned off isn't one. Tried live in pi: a `read` outside the folder asks;
   No returns "The user declined this call" and pi asked for access instead of trying another way; "Allow for this
   session" let a later read of the same file run unasked.
2. `bash`: path words from `tokenize`, the raw-text fallback, `cd`.
3. lsp: clamp roots to the session's folder.

## Not taking

- **An OS sandbox** (`sandbox-exec`, containers). It would stop a program's own reads too, but it's per platform and
  heavy; pi runs on the user's machine on purpose.
- **Blocking instead of asking** (decided 2026-10-24): sometimes the user does want the agent to look elsewhere.
- **Following symlinks** to decide inside or outside. Text comparison matches how the rest of the guard works.

## Decided 2026-10-24

- Core, not a module: always on, with its rule in `src/rule/`, where later core rules go too.

- Ask, not block, with "Allow for this session".
- Both modes, Plan and Build.
- pi's opening `find .. -name AGENTS.md` prompts like any other outside call.
