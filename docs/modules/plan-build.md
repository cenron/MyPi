# Plan / Build

**Status:** building (slices 1–8 built and checked live 2026-10-20; slice 9 2026-10-25)

## Goal

Two modes, the way Claude Code, Codex, and OpenCode work. In **Plan** the agent explores, asks questions, and writes a plan without changing the project. In **Build** it has full access. A dialog at the end of planning hands the plan over to Build.

## Behavior

- Sessions start in **Plan**. The mode is per session and survives resume and fork.
- Three ways to switch, at any time: `/plan` toggles, `/plan plan` and `/plan build` pick a mode, and Shift+Tab
  toggles. Any other mode is an error; words after the mode are ignored, as in `/modules`. Switching shows no
  message, since the footer changes.
- `/plan implement [plan file]` starts a new session in Build, seeded with the plan; with no file, the latest plan in
  `.pi/plans/`. The file is resolved the way the file tools resolve paths (relative to the cwd, `~`, a leading `@`).
  This session keeps its mode.
- The footer always shows the mode: `BUILD` in dim, `PLAN` in the warning color.
- In **Plan**:
  - `edit` and `write` are refused, except inside the project's plans folder, `.pi/plans/`.
  - `bash` runs commands on a read-only allowlist without asking, and asks me before running anything else.
  - `powershell` always asks.
  - Other tools (MCP, other extensions') run without asking only when they're known readers or marked read-only;
    anything else asks.
  - The agent works in three phases, adapted from Codex's plan prompt. It explores before asking, asks about intent, then asks about the implementation until the plan is decision complete. It asks with `ask_user` and submits the finished plan with `submit_plan`.
- When a run that submitted a plan settles, a dialog asks **"Implement this plan?"**:
  1. **Implement**: switch to Build and send "Implement the plan."
  2. **Clear context and implement**: start a new session in Build, seeded with the plan.
  3. **Stay in plan mode**: keep planning. Escape and no-UI sessions also stay.
- Other modules can add choices to the dialog.

## Design in pi

Code layout (2026-10-21): `index.ts` holds the module class; `types.ts` the module's shared types (`Mode` and `isMode`,
`SubmittedPlan`, `PlanActions`, `PlanChoice`); `prompts.ts` the text the model reads (the two mode prompts, and
`implementMessage`, `/plan implement`'s first message); `dialog.ts` the "Implement this plan?"
dialog; `plan-file.ts` the plan files (shared by `submit_plan` and `/plan implement`); `tools/` the two tools, returned
from `tools()` and registered by MyPi's `registerTools` before `init()`; and `commands/plan/`, the whole `/plan` command
(`index.ts` with `planCmd`, and `implement.ts`). `planCmd` takes `PlanCmdActions` (`toggleMode`, `setMode`,
`saveBuildTo`) from `commands()`, the same way the dialog takes `PlanActions`, since the mode methods are private to the
module.

| Piece | pi hook | Notes |
|---|---|---|
| Mode state | `saveState({ mode })`, read back with `loadState()` in `init()` | `Mode` is a const object plus a type, like `ModuleLoadMode`, in `types.ts` with its `isMode` guard, shared by the module and `/plan`. `PlanBuildModule extends BaseModule<{ mode: Mode }>`, so the module owns its state type and core never lists it. Saved as `mypi-module-plan-build`. Check the loaded `mode` with an `isMode` guard, else Plan. Every switch goes through one method that sets the mode, saves it, and updates the footer; `init()` restores and shows the footer without saving, so a `/reload` adds no entry. Same idea as pi's `examples/extensions/plan-mode`. No state files. |
| Footer | `BaseModule.setFooter({ text, color })`, through MyPi's shared footer | See [Shared footer and editor](#shared-footer-and-editor). Pi clears every status on `/reload` and on each session switch (`resetExtensionUI` in `interactive-mode.js`), so `init()` sets it every time, and an unloaded module's label is gone with no cleanup. |
| Telling the model | `BaseModule.setPrompt(text)`, through MyPi's `PromptManager` and `before_agent_start` | One section, `mypi-plan-build`, always present: `PLAN_PROMPT` in Plan, `BUILD_PROMPT` in Build (`prompts.ts`), set in `init()` and on every switch. Leaving Plan replaces the text instead of dropping it, as OpenCode does: a drop only tells the model `Removed system prompt section`, and on models without mid-conversation system messages not even that. The Build text reads fine in a session that never saw Plan, so no transcript check. The Plan text covers only what exists now. It has the model explore first, then ask about intent and then the implementation, one `ask_user` call per unresolved decision with concrete answers, recommended first. It allows writing plan notes in `.pi/plans/` and tells the model to call `submit_plan` with a title and the full plan once it's settled, and to submit again if the plan changes. Before slice 4 it said "don't edit files", and the model then refused to call `write` at all, so the guard's block is a backstop. A switch mid-run reaches the model on the next prompt; the `tool_call` guard enforces the live mode, so its refusal should say why. Pi diffs sections, so the cache stays warm on models that take mid-conversation system messages; see `PromptManager` in [architecture](../architecture.md#core). |
| Hiding tools | `pi.setActiveTools()`, symmetric: entering Plan adds the Plan-only tools, leaving removes them | Nothing is hidden in Plan: `write` must stay active or the `.pi/plans/` exception is unreachable (an inactive tool fails with "not found" before `tool_call`). So no tool list is saved. That matters because pi restores the active tools from the transcript on resume, `/reload`, and tree moves, before `session_start` (`_restoreToolsFromTranscript` in `dist/core/agent-session.js`), so a pre-Plan list kept in memory would be lost on `/reload` in Plan; with add/remove, pi's restored loadout is already right. Plan's tools, `PLAN_TOOLS` (`submit_plan` and `ask_user`), are registered with `defaultActive: false` (a `direct` tool is otherwise active on registration, so Build would see them), and `init()` and every switch call `BaseModule.setToolActive(tool, mode is Plan)` for each. On `/reload` pi marks the active tools pending before `session_start` (`reload` in `agent-session.js`), and on resume the transcript restore keeps unknown names pending, so registering in `init()` brings it back; the call in `init()` only fixes up a new session. A `/plan build` mid-run makes a later `submit_plan` fail with pi's `Tool submit_plan not found`, like any inactive tool. |
| Blocking | A rule on MyPi's shared `ToolGuard`, through `BaseModule.onToolCall` | The real enforcement. `planRule` (`src/core/plan-rule.ts`, in core because read-only subagents use it too) is pure; `init()` registers `(call, env) => mode is Plan ? planRule(call, env) : allow`, so in Build the module has no objection. In Plan, see [Plan rule](#plan-rule). See `ToolGuard` in [architecture](../architecture.md#core) for how pi runs `tool_call` and how rules combine. The rule reads the live mode, so a mid-run switch applies on the next tool call. Block reasons start with "Plan mode is on", name the path, and tell the model not to try another way: it keeps planning, and the user switches to Build. Questions start with "Plan mode is on." and show the command or tool. The guard does the asking, with "Allow for this session" for each ask line; the module never asks itself. |
| Questions | `ask_user({ question, options: [{ label, description? }] })` (`tools/ask-user.ts`), Plan-only like `submit_plan` | One question per call; the model calls it again for the next. Named `ask_user`, not `question`, since pi's example `question` tool may be loaded too. It uses pi's own dialogs rather than a custom TUI like `examples/extensions/question.ts`: `ctx.ui.select(question, [...options, "Type my own answer"], { signal })`, then `ctx.ui.input` for the last entry, or straight away when `options` is empty. `select` only takes strings, so a description goes on its option's line (`label — description`), and the answer is mapped back to the label by index. Esc, an abort, or an empty answer says the user dismissed it; without a UI it tells the model to decide and state the assumption. `executionMode: "sequential"`, so two calls in one turn don't open two dialogs. Plan's rule allows it by name. |
| Plan hand-off | `submit_plan({ title, plan })` (`tools/submit-plan.ts`) writes the plan to `.pi/plans/` and keeps it as the module's `submittedPlan` | Structured text, no parsing of the reply. The file is `<UTC timestamp>-<slug>.md` (`2026-10-20-143205-add-submit-plan.md`, from `planFileName` in `plan-file.ts`): UTC so names sort by time across DST, seconds so two plans a minute apart don't collide, and the slug is the title lowercased with runs of other characters turned into `-`, capped at 50, or `plan` when empty. The file starts with `# <title>`. Creating the folder also writes `.gitignore` containing `*` (`keepOutOfGit`, `#core/util/git`); neither file is ever overwritten (`wx`), so a name clash comes back to the model as an error. `submittedPlan` is in memory only; slice 6 decides when it's cleared. Plan's rule allows the tool by name. |
| Dialog | `agent_settled`, when `aborted` is false and a plan was submitted this run | `agent_end` is too early: the run is still active and retries or follow-ups can follow. The module subscribes with `session.pi.on` in `init()` (modules never unload within an extension instance, so there's nothing to unsubscribe). "This run" is reset on `before_agent_start`, which fires once per run (`_prepareRun`); `agent_start` fires again on each continuation (`agent-loop.js`). It also asks only with a UI and while still in Plan: a user who switched to Build mid-run is already driving. Pi awaits `agent_settled` handlers, and a `sendUserMessage` made meanwhile is deferred until the settle is done (`prompt` checks `_isEmittingAgentSettled` in `agent-session.js`), so Implement's message starts a fresh run. The dialog takes the plan, so it asks once per plan. |
| Clear context | `/plan implement [plan file]` (`commands/plan/implement.ts`), which calls `ctx.newSession({ parentSession, setup, withSession })` | `newSession` exists only on a command's context (`ExtensionCommandContext`), not in event handlers like `agent_settled`, so the dialog choice goes through the command: `pi.sendUserMessage("/plan implement <path relative to the cwd>", { expandPromptTemplates: true })`. Sent during the settle, it's deferred until the settle is done, then runs the command at once. The path is relative because the arguments are split on whitespace; the cwd may hold spaces, a plan's name never does. The command reads the plan first (a missing file fails before leaving the session), then `await ctx.waitForIdle()` for a command typed mid-run (it returns at once on the dialog's path, since pi clears the run flag before `agent_settled`). `setup` runs before the new session's `session_start` (`newSession` in `agent-session-runtime.js`), so it saves `{ mode: "build" }` there with `BaseModule.saveStateTo`, and the new session's `init()` starts in Build; `submit_plan` stays inactive since nothing restores it. `withSession` sends the seed text with the new context's `sendUserMessage`, without awaiting it: it resolves only when the run ends. After the switch the old `ctx` is stale, so the command returns no message; a cancelled `newSession` says so. |
| Toggle key | Shift+Tab, through `BaseModule.onKey` and MyPi's shared editor | Shift+Tab is bound to `app.thinking.cycle`, which pi reserves: `pi.registerShortcut("shift+tab")` is skipped with a "conflicts with built-in shortcut" warning (`RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` in `runner.js`). The shared editor catches the key in `handleInput` before pi's own handling, so it works on any machine without a `keybindings.json` change. Thinking-cycle loses Shift+Tab unless it's rebound there. |

## Shared footer and editor

Plan-build is the first module to need a footer label and a key, and later modules will too, so both are shared MyPi
UI in `src/ui/`, built per session by `Session` and reached through `BaseModule` helpers.

**Footer** (`src/ui/footer.ts`, built). `Session` builds it and exposes it as `session.footer`. A
module calls `setFooter(item)`, where `FooterItem` is `{ text, color: FooterColor }`, or `setFooter(undefined)` to
clear. Each module gets one slot, keyed by `info.name`.

- `FooterColor` is a const object of the theme colors that suit the footer (`FooterColor.WARNING`, `.Dim`, …), the same
  pattern as `MessageType`. Pi exports `ThemeColor` only as a type (49 names, most for markdown, syntax, or borders),
  so this gives modules dot-completion and a short list. `satisfies Record<string, ThemeColor>` checks every value
  against pi, so a pi rename fails the typecheck in `footer.ts`, not in a module.

- The footer keeps its own map of items and draws them. Today it draws with `ctx.ui.setStatus("mypi-<name>", …)`,
  which pi merges into one line under its own footer, sorted by key, so MyPi's items sit together. No `hasUI` guard is
  needed: print mode's `setStatus` does nothing.
- Built to grow into a full custom footer, in the spirit of
  [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer): segments placed left or right, separators,
  pi's own data (model, context, git). Modules only talk to MyPi's footer API, so only the drawing changes:
  - Items keep text and color apart, and the color stays a `FooterColor` name until drawing. A custom footer can then
    place, recolor, or put the text on a background. `setStatus` alone only takes strings with colors baked in.
  - `FooterItem` is an object, so fields such as `position`, `icon` or `order` can be added later without touching
    modules.
  - `ctx.ui.setFooter(factory)` replaces pi's whole footer, so a custom one has to redraw what pi shows (cwd and branch,
    tokens and cost, context %, model and thinking level).
- While MyPi draws through `setStatus`, other footer extensions, pi-powerline-footer included, still show its items.

**Editor** (`src/ui/editor.ts`, built). `Session` builds it next to the footer and exposes it as `session.editor`. A
module calls `onKey(key, handler)`. The shared editor extends pi's `CustomEditor`,
runs a registered handler for a matching key, and passes every other key to `super.handleInput`.

- Pi has one editor slot (`ctx.ui.setEditorComponent`), and the last call wins. A powerline-style footer draws in the
  editor too, so one shared editor avoids modules and the footer fighting over it.
- Pi copies the default editor's text, border color, padding, autocomplete, and app action handlers onto a
  `CustomEditor` subclass when it's installed (`setCustomEditorComponent` in `interactive-mode.js`), so nothing is
  lost.
- The editor calls a handler on its own, not as a method, so pass an arrow function (`() => this.toggleMode()`). A bare
  method (`this.toggle`) loses `this` and throws on every key press; typecheck doesn't catch it.
- It's installed only once a module registers a key, so pi keeps its own editor otherwise. Pi resets the editor on
  `/reload` and on each session switch, so it's installed again from `init()`, and an unloaded module's keys are gone.

## Dialog choices

The dialog is a list of choices, `PLAN_CHOICES` in `dialog.ts` (its types are in `types.ts`): Implement, Clear context and implement (slice 7), and
Stay in plan mode. Other modules adding choices waits until one needs it, along with `isAvailable` for hiding a
choice.

```ts
type PlanActions = {
  switchToBuild: () => void;
  sendUserMessage: (text: string) => void;
  implementInNewSession: (plan: SubmittedPlan) => void; // runs /plan implement with the plan's file
};
type PlanChoice = {
  label: string; // shown by ctx.ui.select; unique
  run: (plan: SubmittedPlan, actions: PlanActions) => void;
};
```

- The title is `Implement this plan?` and, on the next line, the plan's title and file relative to the cwd.
- `ctx.ui.select` returns the chosen label, or `undefined` on Escape or an abort. Map the label back to its choice.
  `undefined` means stay.
- The first choice is highlighted by default, so Implement goes first.
- `run` gets the narrow `PlanActions`, not the module. Implement calls `switchToBuild()` first, so the message runs
  under Build's prompt and rule, then sends `Implement the plan.`

## Seed text for a fresh session

Taken from Codex, then the plan file's path and its contents (`implementMessage` in `prompts.ts`):

> A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

## Plan rule

What plan-build's `ToolGuard` rule returns in Plan, by tool:

| Tool | Verdict |
|---|---|
| `edit`, `write` | Allow when `resolveToolPath(input.path, cwd, home)` is inside one of `env.writableDirs`, else block, naming those folders. Plan-build adds the main checkout's `.pi/plans` (`<cwd>/.pi/plans` outside git); other modules add theirs (memory's folders) with `setWritable`. |
| `bash` | Allow when `isReadOnlyCommand(input.command)`, else ask. |
| `powershell` | Always ask. |
| `read`, `grep`, `find`, `ls`, `tool_search` | Allow: known readers. Pi's built-in tools carry no annotations, so they're listed by name. |
| `codemode` | Allow. Its nested calls each pass through the guard under their own tool name. |
| `submit_plan`, and any tool in `env.writableTools` | Allow. `submit_plan` writes only its own file in `.pi/plans/`, so plan-build adds it with `setWritable` rather than marking it read-only. |
| `ask_user` | Allow. It only asks the user. |
| Anything else | Allow when its `annotations.readOnlyHint` is true, else ask. Annotations come from the tool's author and aren't verified, the same trust pi gives them. |

**Long commands** (fixed 2026-10-21). The ask shows the whole command, and once a model ran a `python3` heredoc with
a fetched web page pasted in. The dialog grew taller than the terminal, pushed its choices off screen, and pi looked
frozen. The guard now shows at most 12 lines of an ask, each cut at 160 characters, and says what it left out
(`… 20 more lines not shown. Yes allows all of it.`). Only the display is cut; see `ToolGuard` in
[architecture](../architecture.md#core).

`isReadOnlyCommand` (`src/core/util/shell.ts`) is strict, because a miss only costs a confirm. Pi's plan-mode example
checks only the first word plus a denylist, so `ls; node …` and the 3a test cases run unasked.

- Split on `|`, `&&`, `||`, `;` and newlines outside quotes, and remove quotes, so `ca't'` is `cat`. Ask on `$(` or
  backticks (inside double quotes too, where they still run), `$'…'` and `$"…"` (`$'-delete'` is `-delete`),
  variables (`$x`, `${x}`, `$1`, `$@`, also inside double quotes, since `find . $X` runs `-delete` when X holds it),
  `<(`, `>(`, `(`, a lone `&`, `&>`, `>|`, `<>`, `<<`, an unterminated quote, and any `>` / `>>` except `N>&M` and to
  `/dev/null`. `< file` is fine, and so is a `$` bash leaves alone (`grep a$`).
- Expand comma braces as bash does, so the checks below see what runs: `wc -l docs/{a,b}.md` is
  `wc -l docs/a.md docs/b.md` and runs unasked, while `find . -{delete,name}` is `find . -delete -name` and asks.
  Braces without a comma stay text (`@{u}`). Ask on ranges (`{a..c}`), nested braces, quotes inside braces, braces in
  a redirect target, and a word that expands to more than 256 words.
- An unquoted glob (`*`, `?`, `[`) passes only for a plain reader (`ls *.ts`, `grep foo src/*.ts`). For the readers
  with a check below it asks, because bash expands the glob to file names, and a file named like a flag gets past the
  check: `find *` in a directory holding a file `-delete` runs `find -delete …`. A quoted pattern (`-name '*.ts'`) is
  fine.
- The first word of every segment must be listed below, so wrappers (`env`, `xargs`, `sh`, `sudo`, `timeout`, …),
  `FOO=1 cmd`, and `/bin/cat` ask without a separate list.
- Plain readers: `cat head tail wc ls pwd stat du df which type whoami id date uname echo printf cut tr nl basename
  dirname realpath readlink cmp comm diff jq grep`.
- Allowed except: `tree` (`-o`), `file` (`-C`), `find` (`-delete`, `-exec`, `-execdir`, `-ok`, `-okdir`, `-fprint`,
  `-fprint0`, `-fprintf`, `-fls`), `fd` (`-x`, `-X`, `--exec`, `--exec-batch`), `rg` (`--pre`, `--hostname-bin`),
  `sort` (`-o`, `--output`, `--compress-program`), `uniq` (more than one operand), `sed` (only `sed -n 'Np'` or
  `'N,Mp'`, `$` for the last line, then files), `git` (below), `npm` (`ls`, `list`, `view`, `info`, `outdated`).
- `git`: `--no-pager` may come first; any other global option (`-c`, `-C`, `-p`, …) asks. Read subcommands: `status
  log show diff blame ls-files ls-tree rev-parse describe shortlog`, and `grep` without `-O`. `--output` asks
  anywhere. `branch` and `tag` allow list flags only, and operands only with `-l`/`--list` (so `branch --contains abc`
  asks; `--contains=abc` doesn't). `remote` bare, `-v`, `show`, `get-url`. `stash list`/`show` (a bare `git stash`
  pushes). `config` with `--get*`, `--list`/`-l`, `get` or `list`, and no write flag. `worktree list` with flags
  only, and `--version`/`version` (added 2026-10-25, after the worktree work asked for both in Plan).
- Flags are checked in every word, since GNU tools take options after operands (`sed -n 1p f -i`). A short-flag
  cluster counts (`sort -ro out`, `fd -HX`), and so does an abbreviated long flag (`sort --out=f`; GNU getopt and git
  accept unambiguous prefixes). `uniq -f 1 f` asks, since `1` looks like a second operand.
- Everything else asks: `awk`, `curl`, `wget`, `node`, `python`, `npx`, `npm run`/`test`, `make`, `tee`, ….
- Tried and rejected (2026-10-22): tree-sitter's bash grammar (`web-tree-sitter` + `tree-sitter-bash`) in place of
  the hand-written tokenizer. It passed every test unchanged and caught `$x`, but the tokenizer only went from 143
  code lines to 119, brace expansion and backslashes stayed ours (tree-sitter only parses), it added about 1.6 MB of
  WASM and a 20 MB package, and Plan had to ask until the grammar loaded. It also has a quirk to work around: in
  `ls 2>/dev/null -la` it puts `-la` inside the redirect. What it taught us (variables, `$"…"`, globs) went into the
  tokenizer instead.

`isInside` is true for the plans folder itself (writing to a directory fails anyway). It compares text, not the file
system, so a symlink inside `.pi/plans/` that points outside counts as inside; following links would need `fs`, and the
helpers stay pure.

## Slices

1. The `Mode` type, `/plan [plan|build]`, the footer label through the shared footer, saving the mode and restoring it
   in `init()`, then Shift+Tab through the shared editor. **Done** (2026-10-19).
2. Prompt sections for entering and leaving Plan, through the shared `PromptManager`. **Done** (2026-10-19).
3. The `tool_call` guard, in two parts, since the guard is shared with later modules:
   - **3a (core).** `ToolGuard`, `BaseModule.onToolCall`, and `MyPi.onToolCall` wired in `index.ts`: **built**
     (2026-10-20), tested, and checked live (tool calls still run after `/reload`). The pure helpers
     `util/shell.ts` and `util/paths.ts`: **built** (2026-10-20), with tests in `test/core/util/`. The `shell.ts`
     tests include the cases pi's plan-mode example lets through (`find -delete`, `awk 'BEGIN{system(…)}'`,
     `curl -o`, `sort -o`, `git diff --output=`, `sed -n '1w …'`, `rg --pre`, `$(…)`, `xargs sh -c`, `env node`,
     `ls; node …`, `git branch <name>`); each asks. **3a done.**
   - **3b (plan-build).** The [Plan rule](#plan-rule). The refusal reason says plan mode is on, since a mid-run switch
     only reaches the prompt section on the next prompt. **Done** (2026-10-20): `planRule` in `rule.ts` (pure), set
     in `init()` through `onToolCall`; it reads the mode on each call, so a switch applies to the next tool call.
     Checked live: a non-allowlisted bash command shows the confirm, No reaches the model as `The user declined this
     call.`, Yes runs it, and `pwd && uname -s` runs unasked. With `PLAN_PROMPT` on, the model refuses to call
     `write` at all, so the block was tested with the prompt switched off for one session: `write` outside
     `.pi/plans/` came back as an error with the Plan reason, no confirm, and no file. `PLAN_PROMPT` ("don't edit
     files") will need to allow writing in `.pi/plans/` once slice 4 writes the plan file there.
4. `submit_plan` and the plan file, with `setActiveTools` adding it in Plan and removing it on leaving. Creating
   `.pi/plans/` also writes `.pi/plans/.gitignore` containing `*`, so plans stay out of git in any project without
   touching its own `.gitignore`. `PLAN_PROMPT` changes to allow writing the plan there and to mention `submit_plan`.
   **Built** (2026-10-20): `tools/submit-plan.ts`, `plan-file.ts`, `BaseModule.registerTool` (since replaced by `tools()`) and `setToolActive`, with
   tests. **Done**: checked live, below.
5. "Allow for this session" in the guard's confirm (core, `ToolGuard`; see [architecture](../architecture.md#core)).
   **Built** (2026-10-20): the dialog is `ctx.ui.select` with Yes, No, and Allow for this session; allowed ask lines
   live in a `Set` on the guard. Tests in `test/core/tool-guard.test.ts`. **Done**.
6. The dialog on `agent_settled`, with the choice list. **Built** (2026-10-20): `dialog.ts` (`offerPlan`,
   `PLAN_CHOICES`), wired in `init()` with `session.pi.on`; tests in `test/module/plan-build/index.test.ts`. **Done**.
7. `/plan implement [plan file]`, the clear-context command; with no file, the latest plan in `.pi/plans/`.
   **Built** (2026-10-20): `implement.ts` (`findPlan`, `implementInNewSession`), `latestPlan` in `plan-file.ts`, the
   dialog's Clear context and implement, `Session.saveTo` and `BaseModule.saveStateTo`; tests in
   `test/module/plan-build/`. **Done**.
8. A question tool. **Built** (2026-10-20): `ask_user` in `tools/ask-user.ts`, Plan-only through `PLAN_TOOLS`, allowed
   by the rule, and named in `PLAN_PROMPT`; tests in `test/module/plan-build/tools/ask-user.test.ts`. **Done**.

Slices 4–8 were checked live in one run (2026-10-20, pi 1.2.0): a fresh session planned a todo CLI with the agent and
built it in a sub-folder.

- Plan's tools: `submit_plan` and `ask_user` active in Plan, gone after `/plan build`, back after `/plan plan` and a
  `/reload` in Plan.
- Allow for this session: a non-allowlisted command asked with three choices; after Allow the same command ran unasked,
  a different one still asked, No reached the model as `The user declined this call.`, and `/reload` forgot the allow.
- `ask_user`: the recommended answer first, descriptions on their line, "Type my own answer" last; a pick returned only
  its label, a typed answer arrived verbatim, and Esc came back as dismissed.
- `submit_plan`: the first submit created `.pi/plans/.gitignore` (`*`) and the plan file; resubmits with one title got
  separate files; nothing was written outside `.pi/plans/` in Plan.
- The dialog: shown after each run that submitted, with the title and file; not shown after a run that submitted
  nothing, or one aborted right after `Plan saved to …`. Stay and Esc stayed in Plan; Implement switched to Build in
  the same session and sent `Implement the plan.`
- Clear context and implement: a new session in Build whose parent is the planning session, holding
  `{ mode: "build" }`, seeded with the hand-off text, the plan's path, and the plan; the planning session's last mode
  stayed `plan`. `/plan implement nope.md` showed ENOENT and stayed; `/plan implement` with no file took the newest
  plan.

9. **Done 2026-10-25: plans that hand over cleanly.** Found while pi planned and built worktree slices 1–3 in one
   session: the context reached 94% and auto-compacted mid-build, the code drifted from the principles as it filled,
   and two plans grew machinery that existing pi APIs already covered. A fresh context per plan fixes most of it, but
   only if the plan file carries everything.
   - **Clear context is the default.** "Clear context and implement" moves first in `PLAN_CHOICES`, so Enter starts a
     fresh Build session from the plan file. "Implement" (same session) stays, second, for small plans.
   - **The plan file is the whole hand-off.** `PLAN_PROMPT` adds: before submitting again, fold every decision and
     correction from the conversation into the plan, since the session that implements it may never see the chat.
     (Decisions made in chat after a plan was written reached the plan on 2026-10-25 only because each was asked for.)
   - **Look before you write, in the plan.** `PLAN_PROMPT` adds: for each new file, saved state, or lifecycle hook,
     the plan names the existing pi or MyPi API it checked and why that falls short. That's the principle's own order
     (pi exports, Node, a MyPi helper), asked at the point where it caught two oversized designs on 2026-10-25: an
     association file where pi's `parentSession` links already served, and an async module `init()` where one await
     in `onSessionStart` did.
   - **No new session while jobs run.** `/plan implement` refuses while background jobs are running and lists them,
     as `/worktree enter` does: a session switch stops them.
   - Not taking: resetting the context with no choice (small plans gain nothing). A reviewer subagent on every
     `submit_plan` was left out because subagents might be off; they're foundational since 2026-10-25, so it's
     worth revisiting once they exist.
   - Goes with [context](context.md) pieces B and D: the Build section names the plan being implemented, and
     asks for a principles check before "done".
   - **Built 2026-10-25** (by pi on gpt-6-luna; the done check sent its first, unfinished pass back): Clear context
     first in `PLAN_CHOICES`; the two `PLAN_PROMPT` lines; `buildPrompt(plan)` naming the plan and asking for the
     principles check; the module's saved state is `{ mode, plan? }`, set by `/plan implement` and the dialog's
     Implement, dropped on Plan; `JobManager.requireNoneRunning()`, shared with `/worktree`.
   - **Tried live** (gpt-6-luna, throwaway repo): after `submit_plan`, Enter took Clear context and the new Build
     session implemented the plan; after `/reload`, asked which plan it was implementing and told to use no tools,
     it answered with the plan file's full path.
   - **Tests:** the dialog's first choice is Clear context; `PLAN_PROMPT` holds both new lines (one test, key phrases);
     `/plan implement` with a running job refuses and names it. Live: submit a plan, press Enter, land in a fresh
     Build session seeded with the plan.
10. **Built 2026-10-26 (roadmap "Self-build fixes").** Keep the thinking level across the hand-off. `/plan
    implement` reads the current level before switching sessions and saves it with the Build state; the new session
    restores it once, then drops it from module state so later resumes respect a level the user picked. The dialog's
    Clear context choice uses the same command. Task seeding lives in [todo](todo.md)'s own prompt section, not
    `buildPrompt(plan)`, so disabling todo removes its instructions.
    **2026-10-26: the model goes along too.** A new session starts on the settings' default model, so a checkpoint
    meant for DeepSeek opened on GPT. `/plan implement` saves the model (`provider/id`) beside the thinking level;
    the new session switches to it (`ctx.modelRegistry.find`, `pi.setModel`), then sets the level, and its first run
    waits for the switch. A model that can't be used (unknown, or no login) is reported, and the session keeps its own.
11. **Built 2026-10-27: a change asked for in Plan isn't attempted.** Asked "create this as an idea in the vault"
    while in Plan (Brainiac, gpt-6-luna), the model wrote the whole 2,055-character note, got the guard's block, then
    did the right thing: `submit_plan` and "switch to Build". The note was generated twice. `PLAN_PROMPT` said "make no
    changes" but not what to do when the user asks for one, so the model read the request as overriding it.
    `PLAN_PROMPT` adds, worded with *when* first as the subagent and todo nudges were: if the user asks for a change
    while plan mode is on, don't attempt it; say so, then put the change in a plan with `submit_plan` or ask them to
    switch with `/plan build`. Measure: blocked `write`/`edit` calls in Plan sessions (2 of 17 writes on 2026-10-27,
    one a live-check artifact) should stay at zero. The guard's block remains the backstop.

## Open questions

None right now.

## Decided (2026-10-20)

- `.pi/plans/` is git-ignored, through the `.gitignore` inside it (slice 4).
- The clear-context command is `/plan implement`, a subcommand of `/plan`. It's handled before the mode check, which
  today throws `Unknown mode` for anything but `plan` and `build`.
- The load type stays `ALWAYS`, so the mode survives resume and fork (`ON_DEMAND` modules start from the defaults
  there).
- Plan files are named `<UTC timestamp>-<title slug>.md`, and `submit_plan` is allowed by name in the Plan rule.
- Module tools live in a `tools/` folder inside the module.
- The question tool is `ask_user`, Plan-only, one question per call, on pi's `select` and `input` dialogs.
- "Allow for this session" is matched on the exact ask line, `<module>: <question>`, and kept in memory, so `/reload`
  forgets it. Built in slice 5.

## References

- Codex: `codex-rs/collaboration-mode-templates/templates/plan.md` and `codex-rs/tui/src/chatwidget/plan_implementation.rs` in openai/codex
- OpenCode: `packages/core/src/plugin/plan.ts` in anomalyco/opencode
- Claude Code: [permission modes, plan mode](https://code.claude.com/docs/en/permission-modes)
- pi: `examples/extensions/plan-mode/`, `examples/extensions/modal-editor.ts` (a `CustomEditor` subclass), and `dist/core/agent-session.js` (`prompt`, `_emitAgentSettled`) in the installed package
- Footer: [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) (`types.ts` and `segments.ts` for the segment model)
