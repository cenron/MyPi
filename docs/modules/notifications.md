# Notifications

**Status:** idea

## Goal

A desktop notification when pi needs me: the agent finished, or a dialog (a permission prompt, "Implement this
plan?", `ask_user`) is waiting. A module, so it can be turned off.

## What pi offers

- **`examples/extensions/notify.ts`**: notifies when the agent is done and waiting for input, through terminal escape
  codes: OSC 777 (Ghostty, iTerm2, WezTerm, rxvt-unicode), OSC 99 (Kitty), and a Windows toast for Windows Terminal.
  No dependencies.
- **`agent_settled`**: fires once pi won't continue on its own, the right moment for "done".

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | A `PushNotification` tool the agent calls for a long task, plus notification hooks. Desktop, and phone when Remote Control is on. |
| OpenCode, Codex CLI | Terminal bell or notification settings; no tool. |

## Behavior

- Notify on `agent_settled`, with the session name and the last line of the reply.
- Notify when a dialog is waiting for an answer.
- Skip it when the terminal has focus, if that can be detected.
- Optionally a tool, so the agent can send one itself (Claude Code's `PushNotification`).

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/notifications/` | Load type open. |
| Done | `session.pi.on("agent_settled")` in `init()` | Like plan-build's dialog. |
| Dialog waiting | Wrap the tool guard's confirm and `ask_user`, or a core hook before any dialog | Needs a small core change. |
| Sending | OSC 777 / OSC 99 escape codes like pi's example, or macOS `osascript` | Escape codes need no dependency but depend on the terminal; inside herdr or tmux they may need passthrough. |

## Open questions

- Escape codes, `osascript`, or both?
- Does it work inside herdr panes?
- Notify on dialogs too, or only when done?
- Add a tool the agent can call?
- Load type: `ON_LOAD` or `ON_DEMAND`?

## References

- pi: `examples/extensions/notify.ts`, `agent_settled` in `docs/extensions.md`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) (`PushNotification`)
