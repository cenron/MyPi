# Plan / Build

**Status:** building (slice 1 done, slice 2 next)

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
| Telling the model | `before_agent_start`: `event.systemPromptOptions.sections` | Pi diffs sections and appends only the change, so the prompt cache stays warm. Leaving Plan replaces the section with a "no longer in plan mode" text instead of dropping it, as OpenCode does. |
| Hiding tools | `pi.setActiveTools()` | Saves the tool list from before Plan and restores it on leaving. `submit_plan` is active only in Plan. |
| Blocking | `tool_call` guard | The real enforcement. Codemode and deferred tools stay callable while inactive, and nested `ctx.executeTool` calls also pass through `tool_call`. Bash asks through `ctx.ui.confirm`; see `examples/extensions/permission-gate.ts`. |
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

## Slices

1. The `Mode` type, `/plan [plan|build]`, the footer label through the shared footer, saving the mode and restoring it
   in `init()`, then Shift+Tab through the shared editor. **Done** (2026-10-19).
2. Prompt sections for entering and leaving Plan.
3. `tool_call` guard with the plans-folder exception and the bash allowlist plus ask, as a pure function with tests. `setActiveTools` alongside it.
4. `submit_plan` and the plan file.
5. The dialog on `agent_settled`, with the choice list.
6. The clear-context command.
7. A question tool.

## Open questions

- Should `.pi/plans/` be git-ignored or committed?
- What's the clear-context command called?
- Which load type when it's done? The mode survives resume and fork only if the module loads then, which `ON_DEMAND`
  doesn't do (resume and fork start from the defaults). The code says `ALWAYS` right now.
- What goes on the bash allowlist? pi's plan-mode example is a starting point, but its regexes let `find -delete`, `awk 'system(…)'`, and `curl -o` through.

## References

- Codex: `codex-rs/collaboration-mode-templates/templates/plan.md` and `codex-rs/tui/src/chatwidget/plan_implementation.rs` in openai/codex
- OpenCode: `packages/core/src/plugin/plan.ts` in anomalyco/opencode
- Claude Code: [permission modes, plan mode](https://code.claude.com/docs/en/permission-modes)
- pi: `examples/extensions/plan-mode/`, `examples/extensions/modal-editor.ts` (a `CustomEditor` subclass), and `dist/core/agent-session.js` (`prompt`, `_emitAgentSettled`) in the installed package
- Footer: [pi-powerline-footer](https://github.com/nicobailon/pi-powerline-footer) (`types.ts` and `segments.ts` for the segment model)
