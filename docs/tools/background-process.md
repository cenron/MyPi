# Background process

**Status:** building (slice 1 done 2026-10-22: the job registry)

## Goal

Let the agent start a long-running command (a dev server, a watch build, a log tail), keep working while it runs, read
its output when it wants, and stop it. Pi 1.2.0's `bash` waits for the command to finish (it only has a `timeout`), so
none of that works today.

## What pi offers

Checked against the installed pi 1.2.0 (2026-10-22):

- **Overriding `bash` is supported.** An extension tool with a built-in's name replaces it
  (`examples/extensions/tool-override.ts`); without its own `renderCall` / `renderResult`, pi keeps the built-in
  renderer. `createBashToolDefinition(cwd, options)` is exported, so an override can hand foreground commands to pi's
  own `bash` unchanged, and plan-build's rule (which checks `bash` commands with `isReadOnlyCommand`) keeps working.
- **Pi's process code is exported.** `createLocalBashOperations().exec(command, cwd, { onData, signal, timeout, env })`
  (`dist/core/tools/bash.js`) uses pi's shell config and environment, spawns `detached`, streams stdout and stderr to
  `onData`, kills the whole process tree (`process.kill(-pid, "SIGKILL")`) when `signal` aborts, and resolves to the
  exit code (`128 + signal` for a killed shell). It also tracks the PID, and pi kills tracked children on an emergency
  exit (`killTrackedDetachedChildren` in `interactive-mode.js`). A background job is that call with an
  `AbortController` the job owns instead of the turn's signal, so Escape doesn't stop it, and no timeout.
  `killProcessTree` itself isn't exported, and nothing here gives stdin (it's `ignore`d), so no interactive programs.
- **Pi's `bash` has no background mode:** input is `{ command, timeout? }`, and it holds the turn until the command
  exits or the timeout kills it. Escape kills it.
- **`pi.sendMessage(message, { triggerTurn?, deliverAs? })`** (`sendCustomMessage` in `dist/core/agent-session.js`):
  - while the agent runs: `deliverAs: "followUp"` queues it for after the current run's tool calls, `"steer"` (the
    default) delivers it after the current tool call;
  - while idle, `triggerTurn: true` starts a run with it (`before_agent_start` sees `messageType: "custom"`);
  - while idle without `triggerTurn`, it's appended and the model sees it next turn;
  - `deliverAs: "nextTurn"` holds it until the next user prompt.
- Long-lived resources start from a tool or `session_start` and stop on an idempotent `session_shutdown`
  (`docs/extensions.md`); MyPi's `Tool.shutdown()` runs there.

## Other harnesses

| Harness | How |
|---|---|
| Claude Code | `Bash` takes `run_in_background: true` and returns a task ID and the path of the file the output is written to. A foreground command that hits its timeout moves to the background instead of being killed. The agent reads the output file with `Read`, and stops a task with `TaskStop`. When a task ends, a notification arrives and resumes the agent. `Monitor` runs a command in the background and feeds each output line back as an event, with a deadline (5 minutes by default, at most 30). |
| OpenCode | `shell` takes `background: true` and returns at once with a shell ID and an output file. Background commands have no timeout by default. When the command ends, OpenCode adds a synthetic message with the result and resumes the agent, so the description says "you will be notified when it completes. DO NOT poll". The model gets no stop or list tool: a job is cancelled when its call or the session is interrupted. |
| Codex CLI | `unified_exec`: `exec_command` runs a command in a PTY and returns after `yield_time_ms` with the output so far and a `session_id` if it's still running. `write_stdin` writes to that session (empty input just polls). The agent drives the process across turns. |

**OpenCode's jobs are shared with subagents** (`packages/core/src/job.ts`, `dev`, 2026-10-22). One `Job` service holds
every long-running thing a session starts, with `kind: "shell"` or `kind: "subagent"`, a status (`running`,
`completed`, `error`, `cancelled`), and its output. A foreground call is a job the call waits on (`block`); a
background one is a job nobody waits on, with a notification when it settles. `background(id)` lets a waiting job go
on unwatched, and `Session.background` does that for every job a session waits on, shells and subagents alike. The
`subagent` tool has the same `background: true` flag over the same service. That's the model for MyPi: a job registry
in core, with shell commands as the first kind and subagents later.

pi package `pi-unified-exec` (0.13.1) ports Codex's model to pi (`exec_command`, `write_stdin`, `kill_session`,
`list_sessions`, `set_on_exit`). Worth borrowing: every byte goes to a log file on disk next to an in-memory tail;
output reaching the model is tail-capped (50 KiB / 2000 lines) and stripped of terminal control sequences; waking the
agent on exit is opt-in (`on_exit: "wake"`, default `"none"`). Its PTY needs an optional native dependency
(`@homebridge/node-pty-prebuilt-multiarch`), and its README runs to 948 lines, a measure of how much the Codex model
asks for.

## Behavior

- `bash` with `background: true` starts the command as a job and returns at once with the job's id and the path of
  its log file. Without `background`, `bash` is pi's own, unchanged.
- The model reads a job's output with `read` on the log file, while it runs or after.
- `job_list` lists the session's jobs; `job_stop` stops one.
- When a job ends, a notice tells the model: the command, how it ended, and its last lines. When the agent is idle,
  the notice starts a turn, so the model never polls.
- A background job has no time limit. Every job still running stops when the pi session ends (quit, `/reload`, a
  session switch); none survive a restart. Log files stay in the temp directory.
- The footer shows how many jobs are running.
- Works in Plan mode under the same rule as `bash`: plan-build checks the command, background or not.

## Design in pi

Decided 2026-10-22.

| Piece | pi hook | Notes |
|---|---|---|
| Job registry | `JobManager` in `src/core/job-manager.ts`, `session.jobs` | Generic: a job is a kind, a label, and a `run(signal, write)` the registry calls, so subagents can be a second kind later (OpenCode's `Job` service does the same). Each job gets an id, a status, a log file, and its last output in memory. |
| Shell jobs | `createLocalBashOperations().exec` | Pi's own spawning: its shell and environment, `detached`, the whole process tree killed when the job's `AbortController` aborts. No timeout, and the turn's signal doesn't reach it. |
| `bash` | Overrides pi's built-in `bash` (`src/tool/bash/`), adding `background?: boolean` | Foreground calls go to `createBashToolDefinition`'s `execute` unchanged. One shell tool, so plan-build's rule applies as it is. Not Codex's `exec_command` + `write_stdin`: no stdin, no PTY, no native dependency. |
| Output | The log file, read with pi's `read` | No output tool, as in Claude Code. `pi-job-<hex>.log` in `os.tmpdir()`, mode `0600`, kept after the job ends. |
| `job_list`, `job_stop` | Two small tools | The model can stop what it started, as with Claude Code's `TaskStop`. |
| Exit notice | `pi.sendMessage({ customType: "mypi-job", … }, { deliverAs: "followUp", triggerTurn: true })` | Queued for after the current run while the agent works; starts a turn when idle. The `bash` description says not to poll. |
| Footer | `session.footer` | The number of running jobs, shown only while there are any. |
| Cleanup | `MyPi.onSessionEnd` calls `session.jobs.stopAll()` | pi also kills tracked children on an emergency exit. |

## Slices

1. **Done.** **The job registry**, in core: start, list, stop, stop all, a log file and an in-memory tail per job, and
   how each job ended. Shell jobs run on pi's `exec`. Everything stops on `session_shutdown`.
2. **The `bash` override:** `background: true` starts a shell job and returns its id and log path; foreground calls
   are pi's `bash` unchanged.
3. **The exit notice** through `sendMessage`, with its own message renderer.
4. **`job_list` and `job_stop`**, and plan-build's rule for them.
5. **The footer item, and rendering** for background starts and the job tools.
6. **Later:** Monitor (output lines streamed back as events, with a deadline), and a foreground command that hits its
   timeout moving to the background, as in Claude Code.

## Slice 1: the job registry

Done 2026-10-22. A `JobManager` in core runs jobs, keeps each job's output in a log file and an in-memory tail,
and records how it ended. Nothing the model can call yet; slice 2 adds `bash` with `background: true`.

Files: `src/core/job-manager.ts` (new: `JobManager`, `Job`, and `shellJob`), `JobStatus`, `JobSpec`, and `JobInfo` in
`src/core/types.ts`, `session.jobs` in `src/core/session.ts`, `stopAll()` in `MyPi.onSessionEnd`, and
`test/core/job-manager.test.ts`.

```ts
// src/core/types.ts

/** How a job stands: running, or how it ended. */
export type JobStatus = "running" | "completed" | "failed" | "stopped";

/** What to run. `kind` is `shell` today, and `subagent` later. */
export interface JobSpec {
  kind: string;
  /** What the job is, for lists and notices, such as the command. */
  label: string;
  /**
   * Runs until it ends: writes output with `write`, resolves to an exit code (0 is success), and stops when `signal`
   * aborts.
   */
  run(signal: AbortSignal, write: (chunk: Buffer | string) => void): Promise<number>;
}

/** A job as the registry reports it. */
export type JobInfo = {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  startedAt: number;
  endedAt?: number;
  /** The exit code `run` resolved to; missing while running, when stopped, or when `run` threw. */
  exitCode?: number;
  /** Why `run` threw, when it did. */
  error?: string;
  /** The file every byte of output goes to, kept after the job ends. */
  logPath: string;
};

// src/core/job-manager.ts

/** A started job: its info as it changes, a promise that settles once it has ended, and its last output lines. */
export type Job = { readonly info: JobInfo; readonly done: Promise<JobInfo>; tail(lines: number): string };

export class JobManager {
  start(spec: JobSpec): Job; // ids count up from "1" in this session
  get(id: string): Job | undefined;
  list(): JobInfo[]; // every job of this session, running or ended, oldest first
  stop(id: string): Promise<JobInfo | undefined>; // waits for it to end; an ended job as is; undefined if unknown
  stopAll(): void; // aborts every running job without waiting; safe to call twice
}

/** A job that runs `command` in `cwd` through pi's own shell, with no time limit. */
export function shellJob(command: string, cwd: string): JobSpec;
```

How it works:

1. `start` takes the next id, opens `pi-job-<16 hex>.log` in `os.tmpdir()` (`flags: "wx"`, `mode: 0o600`, as web_fetch
   saves files), makes the job's `AbortController`, and calls `run(signal, write)`.
2. `write` appends the chunk to the log file and, decoded with a streaming `TextDecoder` (a character split across two
   chunks stays whole), to the tail, which keeps the last 50 KB (pi's `DEFAULT_MAX_BYTES`) and drops the oldest text
   first. Output is kept raw, terminal escape codes included; they're stripped only where it's shown (slice 3).
3. How it ended: `run` resolves to 0 → `completed`; to anything else → `failed` with `exitCode`; rejects after `stop`
   → `stopped`; rejects otherwise → `failed` with `error`. An exit code wins even when a stop came in while it was on
   its way, since the job had ended by then. Then `endedAt` is set, the log closes, and `done` resolves. Output written
   after that is dropped.
4. `stop(id)` aborts a running job and waits for `done`. `stopAll()` aborts every running job without waiting, so
   `session_shutdown` stays synchronous; pi's process-tree kill is a `SIGKILL`.
5. `shellJob` runs `createLocalBashOperations().exec(command, cwd, { onData: write, signal })` and returns its
   `exitCode ?? 1`. It lives in `job-manager.ts`, not a file of its own.
6. `Session` builds one `JobManager` (`session.jobs`); `MyPi.onSessionEnd` calls `session.jobs.stopAll()` before
   `shutdownTools`.

Decided with it: ids count up per session (`"1"`, `"2"`, …) so the model can say "job 3", while log names stay random
so two pi windows never collide; `failed` covers a non-zero exit and a `run` that threw; `list()` keeps every job for
the session, with no cap on ended ones.

Tests (`test/core/job-manager.test.ts`), fake `JobSpec`s whose `run` the test controls except where noted: ids count up
and `list()` is oldest first; output reaches the log file and `tail(n)`, including a multi-byte character split across
two writes; the tail drops the oldest text past 50 KB; a table of how a job ends (resolves 0, resolves 3, rejects,
stopped); `stop` on an ended job and an unknown id; `stopAll` stops every running job and a second call is harmless; the
log file is `0600`. Two use a real shell: `printf 'a\nb\n'` completes with exit code 0 and `a\nb` in the tail and the
log; `sleep 30` stopped ends within a second as `stopped`. No live test: nothing in pi starts a job until slice 2. Also
`test/tool/lifecycle.test.ts` checks `session_shutdown` stops the jobs before the tools' `shutdown()`. All 18 mutations
caught, once a test for output written after the end was added.

## Decided

- A `background` flag on a shell tool, not Codex's model: interactive programs are out.
- Override pi's `bash`, rather than a separate tool.
- The exit notice starts a turn when the agent is idle (OpenCode, Claude Code), rather than pi-unified-exec's opt-in.
- No time limit on background jobs; jobs end with the pi session, with no recovery after a restart.

## References

- pi: `docs/extensions.md` (lifecycle), `sendMessage` in `dist/core/extensions/types.d.ts`,
  `examples/extensions/bash-spawn-hook.ts`, `dist/core/tools/bash.d.ts`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/shell.ts`, `packages/core/src/job.ts`
- Codex (`openai/codex`, `main`): `codex-rs/core/src/tools/handlers/unified_exec/{exec_command,write_stdin}.rs`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § Background commands, Monitor tool
- pi package: [pi-unified-exec](https://pi.dev/packages/pi-unified-exec)
