# Plan / Build

**Status:** building (slices 1 and 2 done; slice 3a's guard built, its helpers next)

## Goal

Two modes, the way Claude Code, Codex, and OpenCode work. In **Plan** the agent explores, asks questions, and writes a plan without changing the project. In **Build** it has full access. A dialog at the end of planning hands the plan over to Build.

## Behavior

- Sessions start in **Plan**. The mode is per session and survives resume and fork.
- Three ways to switch, at any time: `/plan` toggles, `/plan plan` and `/plan build` pick a mode, and Shift+Tab
  toggles. Any other mode is an error; words after the mode are ignored, as in `/modules`. Switching shows no
  message, since the footer changes.
- The footer always shows the mode: `BUILD` in dim, `PLAN` in the warning color.
- In **Plan**:
  - `edit` and `write` are refused, except inside the project's plans folder, `.pi/plans/`.
  - `bash` runs commands on a read-only allowlist without asking, and asks me before running anything else.
  - `powershell` always asks.
  - Other tools (MCP, other extensions') run without asking only when they're known readers or marked read-only;
    anything else asks.
  - The agent works in three phases, adapted from Codex's plan prompt. It explores before asking, asks about intent, then asks about the implementation until the plan is decision complete. It asks with a question tool and submits the finished plan with `submit_plan`.
- When a run that submitted a plan settles, a dialog asks **"Implement this plan?"**:
  1. **Implement**: switch to Build and send "Implement the plan."
  2. **Clear context and implement**: start a new session in Build, seeded with the plan.
  3. **Stay in plan mode**: keep planning. Escape and no-UI sessions also stay.
- Other modules can add choices to the dialog.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Mode state | `saveState({ mode })`, read back with `loadState()` in `init()` | `Mode` is a const object plus a type, like `ModuleLoadMode`, in the module's `index.ts` for now. `PlanBuildModule extends BaseModule<{ mode: Mode }>`, so the module owns its state type and core never lists it. Saved as `mypi-module-plan-build`. Check the loaded `mode` with an `isMode` guard, else Plan. Every switch goes through one method that sets the mode, saves it, and updates the footer; `init()` restores and shows the footer without saving, so a `/reload` adds no entry. Same idea as pi's `examples/extensions/plan-mode`. No state files. |
| Footer | `BaseModule.setFooter({ text, color })`, through MyPi's shared footer | See [Shared footer and editor](#shared-footer-and-editor). Pi clears every status on `/reload` and on each session switch (`resetExtensionUI` in `interactive-mode.js`), so `init()` sets it every time, and an unloaded module's label is gone with no cleanup. |
| Telling the model | `BaseModule.setPrompt(text)`, through MyPi's `PromptManager` and `before_agent_start` | One section, `mypi-plan-build`, always present: `PLAN_PROMPT` in Plan, `BUILD_PROMPT` in Build (`prompts.ts`), set in `init()` and on every switch. Leaving Plan replaces the text instead of dropping it, as OpenCode does: a drop only tells the model `Removed system prompt section`, and on models without mid-conversation system messages not even that. The Build text reads fine in a session that never saw Plan, so no transcript check. The Plan text covers only what exists now; slices 4 and 7 add `submit_plan` and the question tool to it. A switch mid-run reaches the model on the next prompt; the `tool_call` guard enforces the live mode, so its refusal should say why. Pi diffs sections, so the cache stays warm on models that take mid-conversation system messages; see `PromptManager` in [architecture](../architecture.md#core). |
| Hiding tools | `pi.setActiveTools()`, symmetric: entering Plan adds the Plan-only tools, leaving removes them | Nothing is hidden in Plan: `write` must stay active or the `.pi/plans/` exception is unreachable (an inactive tool fails with "not found" before `tool_call`). So no tool list is saved. That matters because pi restores the active tools from the transcript on resume, `/reload`, and tree moves, before `session_start` (`_restoreToolsFromTranscript` in `dist/core/agent-session.js`), so a pre-Plan list kept in memory would be lost on `/reload` in Plan; with add/remove, pi's restored loadout is already right. The first Plan-only tool is `submit_plan` (slice 4), so `setActiveTools` starts there. |
| Blocking | A rule on MyPi's shared `ToolGuard`, through `BaseModule.onToolCall` | The real enforcement. See `ToolGuard` in [architecture](../architecture.md#core) for how pi runs `tool_call` and how rules combine. In Build the rule has no objection. In Plan, see [Plan rule](#plan-rule). The rule reads the live mode, so a mid-run switch applies on the next tool call. Block reasons start with "Plan mode is on:" and tell the model to ask for Build (`/plan build` or Shift+Tab). The guard does the asking; the module never calls `confirm`. |
| Questions | Question tool | See `examples/extensions/question.ts` and `questionnaire.ts`. |
| Plan hand-off | `submit_plan` stores the plan and writes it to `.pi/plans/` | Structured text, no parsing of the reply. |
| Dialog | `agent_settled`, when `aborted` is false and a plan was submitted this run | `agent_end` is too early: the run is still active and retries or follow-ups can follow. |
| Clear context | A command that calls `ctx.newSession({ withSession })` | `newSession` exists only on a command's context. The choice sends the command with `pi.sendUserMessage(…, { expandPromptTemplates: true })`, which runs extension commands immediately, so it is only safe once the agent is idle. The new session reads the plan from its file. |
| Toggle key | Shift+Tab, through `BaseModule.onKey` and MyPi's shared editor | Shift+Tab is bound to `app.thinking.cycle`, which pi reserves: `pi.registerShortcut("shift+tab")` is skipped with a "conflicts with built-in shortcut" warning (`RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS` in `runner.js`). The shared editor catches the key in `handleInput` before pi's own handling, so it works on any machine without a `keybindings.json` change. Thinking-cycle loses Shift+Tab unless it's rebound there. |

## Shared footer and editor

Plan-build is the first module to need a footer label and a key, and later modules will too, so both are shared MyPi
UI in `src/ui/`, built per session by `Session` (like `Notifier`) and reached through `BaseModule` helpers.

**Footer** (`src/ui/footer.ts`, built). `Session` builds it next to `Notifier` and exposes it as `session.footer`. A
module calls `setFooter(item)`, where `FooterItem` is `{ text, color: FooterColor }`, or `setFooter(undefined)` to
clear. Each module gets one slot, keyed by `info.name`.

- `FooterColor` is a const object of the theme colors that suit the footer (`FooterColor.Warning`, `.Dim`, …), the same
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

The dialog is a list of choices. The plan-build module adds the three above, and other modules can add their own.

```ts
type PlanChoice = {
  label: string;                         // shown by ctx.ui.select; unique
  isAvailable?: (plan: Plan) => boolean; // hidden when false
  run: (plan: Plan, ctx: ExtensionContext) => Promise<void> | void;
};
```

- `ctx.ui.select` returns the chosen label, or `undefined` on Escape. Map the label back to its choice. `undefined` means stay.
- The first choice is highlighted by default, so Implement goes first.
- Give `run` a narrow interface (set the mode, the plan, send a message) rather than all of `MyPi`.

## Seed text for a fresh session

Taken from Codex:

> A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

## Plan rule

What plan-build's `ToolGuard` rule returns in Plan, by tool:

| Tool | Verdict |
|---|---|
| `edit`, `write` | Allow when `isInside(<cwd>/.pi/plans, resolveToolPath(input.path, cwd, home))`, else block. |
| `bash` | Allow when `isReadOnlyCommand(input.command)`, else ask. |
| `powershell` | Always ask. |
| `read`, `grep`, `find`, `ls`, `tool_search` | Allow: known readers. Pi's built-in tools carry no annotations, so they're listed by name. |
| `codemode` | Allow. Its nested calls each pass through the guard under their own tool name. |
| Anything else | Allow when its `annotations.readOnlyHint` is true, else ask. Annotations come from the tool's author and aren't verified, the same trust pi gives them. |

`isReadOnlyCommand` (`src/core/util/shell.ts`) is strict, because a miss only costs a confirm. Pi's plan-mode example
checks only the first word plus a denylist, so `ls; node …` and the 3a test cases run unasked.

- Split on `|`, `&&`, `||`, `;` and newlines outside quotes. Ask on `$(`, backticks, `<(`, `>(`, `&`, `(`, or any `>` /
  `>>` except `2>&1` and `/dev/null`. Ask when a segment starts with a wrapper (`env`, `xargs`, `sh`, `bash`, `eval`,
  `exec`, `command`, `nice`, `timeout`, `time`, `sudo`).
- Plain readers: `cat head tail wc ls pwd tree file stat du df which type whoami id date uname echo printf cut tr nl
  basename dirname realpath readlink cmp comm diff jq grep`.
- Allowed except: `find` (`-delete`, `-exec*`, `-ok*`, `-fprint*`, `-fls`), `fd` (`-x`, `-X`, `--exec*`), `rg`
  (`--pre`), `sort` (`-o`, `--output`), `uniq` (more than one file), `sed` (only `sed -n 'Np'` or `'N,Mp'`), `git` (read
  subcommands only: `status log show diff blame ls-files ls-tree rev-parse describe shortlog grep`; no `-c` or
  `--output`; `branch`/`tag`/`remote`/`stash` in list forms; `config` with `--get`/`--list`), `npm` (`ls`, `list`,
  `view`, `info`, `outdated`).
- Everything else asks: `awk`, `curl`, `wget`, `node`, `python`, `npx`, `npm run`/`test`, `make`, `tee`, ….

## Slices

1. The `Mode` type, `/plan [plan|build]`, the footer label through the shared footer, saving the mode and restoring it
   in `init()`, then Shift+Tab through the shared editor. **Done** (2026-10-19).
2. Prompt sections for entering and leaving Plan, through the shared `PromptManager`. **Done** (2026-10-19).
3. The `tool_call` guard, in two parts, since the guard is shared with later modules:
   - **3a (core).** `ToolGuard`, `BaseModule.onToolCall`, and `MyPi.onToolCall` wired in `index.ts`: **built**
     (2026-10-20), tested, and checked live (tool calls still run after `/reload`). Next: the pure helpers
     `util/shell.ts` and `util/paths.ts`, with tests in `test/core/util/`. The `shell.ts` tests include the cases pi's
     plan-mode example lets through (`find -delete`, `awk 'BEGIN{system(…)}'`, `curl -o`, `sort -o`,
     `git diff --output=`, `sed -n '1w …'`, `rg --pre`, `$(…)`, `xargs sh -c`, `env node`, `ls; node …`,
     `git branch <name>`); each must ask.
   - **3b (plan-build).** The [Plan rule](#plan-rule). The refusal reason says plan mode is on, since a mid-run switch
     only reaches the prompt section on the next prompt.
4. `submit_plan` and the plan file, with `setActiveTools` adding it in Plan and removing it on leaving.
5. The dialog on `agent_settled`, with the choice list.
6. The clear-context command.
7. A question tool.

## Open questions

- Should `.pi/plans/` be git-ignored or committed?
- What's the clear-context command called?
- Which load type when it's done? The mode survives resume and fork only if the module loads then, which `ON_DEMAND`
  doesn't do (resume and fork start from the defaults). The code says `ALWAYS` right now.
- "Allow for this session" in the guard's confirm: deferred.

## References

- Codex: `codex-rs/collaboration-mode-templates/templates/plan.md` and `codex-rs/tui/src/chatwidget/plan_implementation.rs` in openai/codex
- OpenCode: `packages/core/src/plugin/plan.ts` in anomalyco/opencode
- Claude Code: [permission modes, plan mode](https://code.claude.com/docs/en/permission-modes)
- pi: `examples/extensions/plan-mode/`, `examples/extensions/modal-editor.ts` (a `CustomEditor` subclass), and `dist/core/agent-session.js` (`prompt`, `_emitAgentSettled`) in the installed package
- Footer: [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) (`types.ts` and `segments.ts` for the segment model)
