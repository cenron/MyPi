# Plan / Build

**Status:** planned

## Goal

Two modes, the way Claude Code, Codex, and OpenCode work. In **Plan** the agent explores, asks questions, and writes a plan without changing the project. In **Build** it has full access. A dialog at the end of planning hands the plan over to Build.

## Behavior

- Sessions start in **Build**. The mode is per session and survives resume and fork.
- A toggle switches modes at any time. The footer shows the current mode.
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
| Mode state | `pi.appendEntry("mypi-mode", …)`, read back on `session_start` | Same as pi's `examples/extensions/plan-mode`. No state files. |
| Telling the model | `before_agent_start`: `event.systemPromptOptions.sections` | Pi diffs sections and appends only the change, so the prompt cache stays warm. Leaving Plan replaces the section with a "no longer in plan mode" text instead of dropping it, as OpenCode does. |
| Hiding tools | `pi.setActiveTools()` | Saves the tool list from before Plan and restores it on leaving. `submit_plan` is active only in Plan. |
| Blocking | `tool_call` guard | The real enforcement. Codemode and deferred tools stay callable while inactive, and nested `ctx.executeTool` calls also pass through `tool_call`. Bash asks through `ctx.ui.confirm`; see `examples/extensions/permission-gate.ts`. |
| Questions | Question tool | See `examples/extensions/question.ts` and `questionnaire.ts`. |
| Plan hand-off | `submit_plan` stores the plan and writes it to `.pi/plans/` | Structured text, no parsing of the reply. |
| Dialog | `agent_settled`, when `aborted` is false and a plan was submitted this run | `agent_end` is too early: the run is still active and retries or follow-ups can follow. |
| Clear context | A command that calls `ctx.newSession({ withSession })` | `newSession` exists only on a command's context. The choice sends the command with `pi.sendUserMessage(…, { expandPromptTemplates: true })`, which runs extension commands immediately, so it is only safe once the agent is idle. The new session reads the plan from its file. |
| Toggle key | Shift+Tab | Pi reserves it for `app.thinking.cycle` and skips extension shortcuts on it. Either subclass `CustomEditor`, as radian does, or rebind thinking in `keybindings.json`. |

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

1. `Mode` type, a toggle command, and the footer status.
2. Prompt sections for entering and leaving Plan.
3. `tool_call` guard with the plans-folder exception and the bash allowlist plus ask, as a pure function with tests. `setActiveTools` alongside it.
4. Saving the mode in the session and restoring it.
5. `submit_plan` and the plan file.
6. The dialog on `agent_settled`, with the choice list.
7. The clear-context command.
8. Shift+Tab.
9. A question tool.

## Open questions

- Should `.pi/plans/` be git-ignored or committed?
- Which Shift+Tab approach: a custom editor or rebinding thinking?
- What are the command names: `/plan` to toggle, and what for the clear-context command?
- What goes on the bash allowlist? pi's plan-mode example is a starting point, but its regexes let `find -delete`, `awk 'system(…)'`, and `curl -o` through.

## References

- Codex: `codex-rs/collaboration-mode-templates/templates/plan.md` and `codex-rs/tui/src/chatwidget/plan_implementation.rs` in openai/codex
- OpenCode: `packages/core/src/plugin/plan.ts` in anomalyco/opencode
- Claude Code: [permission modes, plan mode](https://code.claude.com/docs/en/permission-modes)
- pi: `examples/extensions/plan-mode/` and `dist/core/agent-session.js` (`prompt`, `_emitAgentSettled`) in the installed package
