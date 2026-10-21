# Background process

**Status:** idea

## Goal

Let the agent start a long-running command (a dev server, a watch build, a log tail), keep working while it runs, read
its output when it wants, and stop it. Pi 1.2.0's `bash` waits for the command to finish (it only has a `timeout`), so
none of that works today.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | `Bash` takes `run_in_background: true` and returns a task ID and the path of the file the output is written to. A foreground command that hits its timeout moves to the background instead of being killed. The agent reads the output file with `Read`, and stops a task with `TaskStop`. `Monitor` runs a command in the background and feeds each output line back as an event, with a deadline (5 minutes by default, at most 30). |
| OpenCode | `shell` takes `background: true` and returns at once with a shell ID and an output file. Background commands have no timeout by default. When the command ends, OpenCode adds a synthetic message to the session with the result, so the description says "you will be notified when it completes. DO NOT poll". |
| Codex CLI | `unified_exec`: `exec_command` runs a command in a PTY and returns after `yield_time_ms` with the output so far and a `session_id` if it's still running. `write_stdin` writes to that session (empty input just polls). The agent drives the process across turns. |

pi package `pi-unified-exec` ports Codex's model to pi (`exec_command`, `write_stdin`, plus `kill_session` and
`list_sessions`). Useful to read.

## Behavior

- Start a command in the background and get an ID back at once.
- Read its output so far, tail-first and capped.
- Stop it.
- List what's running.
- Be told when it exits, without polling.
- Everything still running is killed when the session ends.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tools | A folder, `src/tool/background-process/`, listed in `createTools` | Either a `background: true` flag on our own shell tool plus `process_output` / `process_stop` / `process_list`, or Codex's `exec_command` + `write_stdin`. Open question. |
| Process registry | One per session, held in core | `child_process.spawn`, output appended to a file under the session's temp dir and kept in a ring buffer for quick reads. |
| Exit notice | `pi.sendMessage({ customType, content, display }, { deliverAs: "followUp", triggerTurn })` | Like OpenCode's synthetic message: command, exit code, and the last lines of output. Whether it starts a turn when idle is an open question. |
| Monitor | Each new output line (batched) becomes a message, with a deadline | Claude Code's `Monitor`. Could be the same registry with a `watch` flag. Later slice. |
| Cleanup | The tool's `shutdown()` (run on `session_shutdown`) kills everything in the registry | pi's docs: start long-lived resources from a tool or `session_start`, never from the factory, and close them in an idempotent `session_shutdown`. |
| Permissions | The command goes through the tool guard like `bash` | plan-build's rule must check the command with `isReadOnlyCommand`, the same as for `bash`. |

## Slices

1. The registry: spawn, output file plus ring buffer, stop, kill all on `session_shutdown`.
2. Start, output, stop, and list tools.
3. The exit notice through `sendMessage`.
4. The tool guard and plan-build rule for background commands.
5. Monitor: stream output lines back as events, with a deadline.

## Open questions

- Tool shape: a `background` flag on a shell tool (Claude Code, OpenCode) or Codex's `exec_command` + `write_stdin`?
  Codex's model also covers interactive programs (stdin), but needs a PTY (`node-pty`, a native dependency).
- Override pi's built-in `bash` to add `background`, or keep `bash` as it is and add separate tools?
- Should a foreground command that hits its timeout move to the background, like Claude Code?
- Does the exit notice start a turn when the agent is idle, or wait for the next user message?
- Time limit on background processes, or none (OpenCode, and Claude Code in interactive sessions)?

## References

- pi: `docs/extensions.md` (lifecycle), `sendMessage` in `dist/core/extensions/types.d.ts`,
  `examples/extensions/bash-spawn-hook.ts`, `dist/core/tools/bash.d.ts`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/shell.ts`, `packages/core/src/job.ts`
- Codex (`openai/codex`, `main`): `codex-rs/core/src/tools/handlers/unified_exec/{exec_command,write_stdin}.rs`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § Background commands, Monitor tool
- pi package: [pi-unified-exec](https://pi.dev/packages/pi-unified-exec)
