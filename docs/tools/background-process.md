# Background process

**Status:** done (slices 1–5, 2026-10-22: the job registry, `bash` with `background: true`, the exit notice,
`job_list` / `job_stop`, and the footer and display). Slice 6 is for later. `job_wait` added 2026-10-26 with
subagents.

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
| Footer | `session.footer` | The number of running jobs, shown only while there are any, published on the `jobs` channel of the [event bus](../modules/done-check.md#the-event-bus). |
| Cleanup | `MyPi.onSessionEnd` calls `session.jobs.stopAll()` | pi also kills tracked children on an emergency exit. |

## Slices

1. **Done.** **The job registry**, in core: start, list, stop, stop all, a log file and an in-memory tail per job, and
   how each job ended. Shell jobs run on pi's `exec`. Everything stops on `session_shutdown`.
2. **Done.** **The `bash` override:** `background: true` starts a shell job and returns its id and log path; foreground calls
   are pi's `bash` unchanged.
3. **Done.** **The exit notice** through `sendMessage`, with its own message renderer.
4. **Done.** **`job_list` and `job_stop`**, and plan-build's rule for them.
5. **Done.** **The footer item, and rendering** for background starts (the job tools kept pi's default drawing).
6. **Later:** Monitor (output lines streamed back as events, with a deadline), and a foreground command that hits its
   timeout moving to the background, as in Claude Code.

## Slice 1: the job registry

Done 2026-10-22. A `JobManager` in core runs jobs, keeps each job's output in a log file and an in-memory tail,
and records how it ended. Nothing the model can call yet; slice 2 adds `bash` with `background: true`.

Files: `src/core/job-manager.ts` (new: `JobManager`, and `shellJob`, which slice 2 moved to `src/tool/bash/`),
`JobStatus`, `JobSpec`, `JobInfo`, and `Job` in `src/core/types.ts`, `session.jobs` in
`src/core/session.ts`, `stopAll()` in `MyPi.onSessionEnd`, and `test/core/job-manager.test.ts`.

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

/** A started job: its info as it changes, a promise that settles once it has ended, and its last output lines. */
export type Job = { readonly info: JobInfo; readonly done: Promise<JobInfo>; tail(lines: number): string };

// src/core/job-manager.ts

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

## Slice 2: the `bash` override

Done 2026-10-22. MyPi's `bash` is pi's own plus `background: true`, which starts the command as a job and returns at
once with its id and log file. Without it, the call goes to pi's `bash` unchanged.

Files: `src/tool/bash/index.ts` (new: `bashTool`, and `shellJob` moved from `job-manager.ts`), `bashTool(session)` first
in `createTools` (`src/tool/index.ts`), and `test/tool/bash/index.test.ts`.

```ts
/** What a background start returns. Built on pi's `BashToolDetails` (all optional), so pi's renderer takes it. */
export type BackgroundDetails = BashToolDetails & { jobId: string; logPath: string };

/**
 * pi's `bash` plus `background: true`, which starts the command as a job in `session.jobs` and returns at once with
 * its id and log file. Without it, the call is pi's own `bash`, unchanged.
 */
export function bashTool(session: Session): Tool;

/** A job that runs `command` in `cwd` through pi's own shell, with no time limit. */
export function shellJob(command: string, cwd: string): JobSpec;
```

How it works:

1. `createBashToolDefinition(session.ctx.cwd)` builds pi's `bash`. MyPi's spreads it, so it keeps pi's prompt snippet
   and guidelines, `outputSchema`, and `constrainedSampling`. pi's definition has no renderer: pi draws `bash` with its
   built-in one (`withBuiltInRenderers`) because MyPi's supplies none. (This said "keeps pi's renderer" until slice 5
   found otherwise.)
2. `parameters` are pi's (`command`, `timeout`) plus `background?: boolean`, whose description says it's for dev
   servers, watchers, and anything that doesn't exit, and that `timeout` doesn't apply. The tool description adds one
   sentence pointing to it.
3. Without `background`, `execute` passes `{ command, timeout }` and the call's signal, `onUpdate`, and `ctx` to pi's
   `execute`, and returns its result as is.
4. With it, `execute` starts `shellJob(command, ctx.cwd)` in `session.jobs` and returns `Started job <id> in the
   background: <command>\nOutput: <logPath>\nRead that file for its output.`, with `details: { jobId, logPath }` and a
   `structuredContent` in pi's `outputSchema` shape (`output` is the same text, `exit_code` 0), since a tool that
   declares one must always set it. The turn's signal isn't passed on, so Escape doesn't stop the job.
5. A background job runs in the call's `cwd` with pi's shell environment (`getShellEnv()`, which `exec` uses by
   default), but without the `PI_*` session variables pi's own `execute` adds.

Decided with it: `shellJob` lives with `bash`, and `JobManager` stays generic in core; `timeout` is ignored with
`background`; no `PI_*` variables in background jobs; pi's renderer until slice 5; details carry `jobId` and `logPath`
for slices 3 and 5; Plan mode checks a background command like any other (`npm run dev` is asked about).

Tests (`test/tool/bash/index.test.ts`, real processes): a foreground `echo hi` returns `hi` and starts no job; a
background `pwd` in the temp folder returns the start text and details, ends `completed`, and logs the temp folder's
real path (the cwd and `shellJob` together); a background `sleep 30` keeps running after the call's signal aborts, and
`stop` ends it within a second. `shellJob`'s two tests moved here, merged into those. The lifecycle and `registerTools`
tests list `bash` first. Mutations caught: always running in the foreground, the session's cwd instead of the call's,
and changing the foreground command.

## Slice 3: the exit notice

Done 2026-10-22. When a background job ends, a `mypi-job` message tells the model how it ended, how long it ran, its
last lines, and its log file. It's queued for after the current run while the agent works, and starts a turn when the
agent is idle, so the model never polls.

Files: `src/tool/bash/notice.ts` (new: `jobNotice`, `formatNotice`, `renderNotice`), the notice and the renderer in
`src/tool/bash/index.ts`, `test/tool/bash/notice.test.ts` (new), `test/tool/bash/index.test.ts`, and
`sendMessage` / `registerMessageRenderer` in the fake pi (`test/fakes.ts`, `test/index.test.ts`,
`test/tool/lifecycle.test.ts`).

```ts
/** The custom message type of a job's exit notice. */
export const JOB_NOTICE = "mypi-job";

/** How many of a job's last lines a notice carries. */
export const NOTICE_LINES = 20;

/** What a notice carries for its renderer: the job as it ended, and its last lines with escape codes stripped. */
export type NoticeDetails = { job: JobInfo; tail: string };

/**
 * The exit notice for a job that ended: the model's text and the details its renderer draws. `tail` is the job's last
 * lines as written; escape codes are stripped and it's cut to its last 2,000 characters.
 */
export function jobNotice(job: JobInfo, tail: string): { content: string; details: NoticeDetails };

/** Draws a notice: one line collapsed, in green or red, with its last lines expanded. Undefined without details. */
export const renderNotice: MessageRenderer<NoticeDetails>;
```

The model's text, for a job that completed:

```
Background job 1 completed (exit code 0) after 3.0s: for i in 1 2 3; do echo tick $i; sleep 1; done
Last lines:
tick 1
tick 2
tick 3
done
Full output: /…/pi-job-ac88….log
```

A failed job reads `failed (exit code 3)`; one whose command couldn't run reads `failed`, with an `Error: …` line after
the first. No output gives `No output.` in place of the last lines.

How it works:

1. Each background start attaches `noticeOnEnd(job)`: once `job.done` settles, unless the job was `stopped` or the tool
   has shut down, it calls `session.pi.sendMessage({ customType: JOB_NOTICE, display: true, content, details },
   { deliverAs: "followUp", triggerTurn: true })` with `jobNotice(info, job.tail(NOTICE_LINES))`. A failure there is
   logged, never left as an unhandled rejection.
2. The tool's `init()` registers `renderNotice` for `mypi-job` (pi accepts it during `session_start`; it looks
   renderers up when it draws), and its `shutdown()` sets `closed`, so a job that ends while the session closes sends
   nothing.
3. pi delivers the notice to the model as a user message. A run it starts has `messageType: "custom"`, on which MyPi
   writes its prompt sections, so plan-build's prompt still applies.
4. Collapsed, the renderer shows `job 1 completed · exit 0 · 3.0s · <command>` (green, or red for `failed`, with the
   error on the next line), plus `(ctrl+o to expand)` when there's output; expanded, it adds the last lines.
5. The `background` parameter's description now says a message comes when the job ends, and not to poll or sleep.

Decided with it: notices for `completed` and `failed` only, since a stop is reported by whatever stopped it; the last
20 lines, at most 2,000 characters; escape codes stripped in the notice, the log file kept raw; each start attaches its
own `job.done` handler, and a generic `JobManager` listener waits for slice 5; the renderer is registered from the
tool's `init()`; the notice says how long the job ran. The spec's `noticeText(job, tail)` became `jobNotice(job, tail)`,
returning the text and the details together so the tail is cleaned once.

Tests: a `jobNotice` table (completed, a failed exit code, a command that couldn't run with no output) and one test
for stripping and the cut; `formatNotice` collapsed and expanded; through the tool, a background `printf` sends one
notice with the text and options above and `init()` registers the renderer; a stopped job and a job that ends after
`shutdown()` send nothing. Mutations caught: dropping either guard, `nextTurn` delivery, no renderer, no strip, no cut,
no error line, and no collapsed form.

## Slice 4: `job_list` and `job_stop`

Done 2026-10-22. The model can list the session's background jobs and stop one. Plan mode needs no rule change:
plan-build's default allows a tool marked `readOnlyHint: true` and asks about the rest, so `job_list` runs and
`job_stop` asks.

Files: `src/tool/jobs/index.ts` (new: `jobListTool`, `jobStopTool`), both in `createTools` after `bash`; `jobEnding`
and `jobDuration` moved from `bash/notice.ts` to `src/tool/utils.ts`, which the notice and both tools use; `bash`'s
start text and `background` description mention `job_stop`; `test/tool/jobs/index.test.ts` (new).

```ts
/** `job_list`: every background job of this session, running or ended, oldest first, with its log file. */
export function jobListTool(session: Session): Tool;

/** `job_stop`: stops a running background job and waits for it to end; its log file is kept. */
export function jobStopTool(session: Session): Tool;

/** How a job ended, or `running`: `completed (exit code 0)`, `failed (exit code 3)`, `failed`, `stopped`. */
export function jobEnding(job: JobInfo): string;

/** How long a job ran, or has run so far while it's running, such as `3.0s`. */
export function jobDuration(job: JobInfo): string;
```

How it works:

1. `job_list` takes no parameters and is `{ readOnlyHint: true }`. It returns `Background jobs in this session, oldest
   first:` and one line per job, `<id> · <ending> · <duration> · <command> · <log file>`, or `No background jobs in
   this session.`
2. `job_stop` takes `{ id }` and is `{ readOnlyHint: false, destructiveHint: false }` (stopping kills a process but
   changes no files). It calls `session.jobs.stop(id)`, which aborts the job and waits for it to end, and returns
   `Stopped job <id> after <duration>: <command>\nOutput: <log file>`. A job that had already ended, or that exited on
   its own just as the stop arrived (its exit code wins), gives `Job <id> had already ended: <ending>.`; an unknown id
   throws `No job <id> in this session; job_list shows them.`
3. A stop sends no exit notice (slice 3), so `job_stop`'s result is how the model learns the job stopped.
4. `bash`'s start text ends `Read that file for its output; stop it with job_stop.`, and the `background` description
   says to stop it with `job_stop`.

Decided with it: both tools in `src/tool/jobs/`, over `session.jobs` for any job kind, so subagent jobs show up later
unchanged; Plan allows `job_list` and asks about `job_stop` (adding `job_stop` to plan-build's `ALLOWED` would let the
model stop a dev server the user started in Build without asking); stopping an ended job is a normal result, an
unknown id an error; the list shows every job with its log file, with no filter; pi's default display until slice 5.

Tests (`test/tool/jobs/index.test.ts`, fake `JobSpec`s and a fixed clock): `job_list` empty, then with a running and an
ended job (its exact text); `job_stop` stops a running job; on an ended job, one that exits as the stop arrives, and an
unknown id; the two tools' annotations. The lifecycle and `registerTools` lists gain both names. Mutations caught:
always "Stopped", reporting a racing exit as stopped, a line without its log file, a running job's duration frozen at
0, no annotations, and the tools left out of `createTools`.

## Slice 5: the footer item and display

Done 2026-10-22. Since 2026-10-24 (done-check slice 1), the count goes over the event bus's `jobs` channel, and
`onChange` below is gone; `stopAll()` stops publishing instead of dropping listeners. The footer shows how many jobs are running, and background `bash` calls get their own short drawing;
foreground calls keep pi's.

Files: `onChange` in `src/core/job-manager.ts`, the footer wiring in `src/core/session.ts`, `src/tool/bash/render.ts`
(new: `backgroundRenderer`), its registration in `MyPi`'s constructor (`src/mypi.ts`), the corrected comment in
`src/tool/bash/index.ts`; tests in `test/core/job-manager.test.ts`, `test/core/session.test.ts`,
`test/tool/bash/render.test.ts` (new), and `test/index.test.ts`.

```ts
// job-manager.ts
/**
 * Calls `listener` with the number of running jobs whenever a job starts or ends. Returns a function that removes it.
 * `stopAll()` drops every listener, since it runs only when the session ends.
 */
onChange(listener: (running: number) => void): () => void;

// bash/render.ts
/**
 * Draws background `bash` calls as `$ <command> (background)` and their result as `job <id> started · <log file>`;
 * every other call, and an error, is drawn by `next()`, pi's own `bash` renderer. Other tools get `next()` as is.
 */
export const backgroundRenderer: ToolRendererResolver;
```

How it works:

1. `JobManager` keeps a set of listeners and calls each with the number of `running` jobs after `start` adds a job and
   after a job's `done` settles. `stopAll()` clears them before aborting, since the jobs end after the session has.
2. `Session`'s constructor subscribes its footer: `1 job` or `<n> jobs` in accent under the `jobs` key (drawn as the
   `mypi-jobs` status on pi's footer line, just before `PLAN`/`BUILD`), cleared at 0.
3. `backgroundRenderer` is a `pi.registerToolRenderer` resolver. For `bash`, it wraps `next()`'s renderers: a call with
   `background: true` is drawn `$ <command>` in pi's call style plus a dim `(background)`, and a result with `jobId` and
   `logPath` in its details as a muted `job <id> started · <log file>`, in place of the model's hint text and pi's
   `Took 0.0s`. Everything else goes to pi's renderer, so foreground calls keep pi's look, timer, and truncation.
4. `MyPi`'s constructor registers it, once per extension load. The spec had `bash`'s `init()` do it, but pi keeps
   resolvers in a list (`extension.toolRenderers.push`), so one registered on every `session_start` would stack.

Decided with it: `Session` sets the footer, since the count covers every job kind; `1 job` / `<n> jobs` in accent,
only while a job runs; `stopAll()` drops the listeners; a resolver that delegates to `next()`, not a renderer of our
own for every `bash` call; `job_list` and `job_stop` keep pi's default drawing; slice 2's wrong comment and docs fixed.

Tests: `onChange` reports 1, 2, 1 as jobs start and one ends, stops after its remover runs, and hears nothing once
`stopAll()` has run; the session footer goes `1 job`, `2 jobs`, `1 job`, cleared; the renderer draws a background call
and its start, and leaves a foreground call, an error, a result without job details, and other tools to pi; the
resolver is registered once however many sessions start. Mutations caught: no notify on start or on end, listeners
kept by `stopAll()`, a remover that does nothing, counting ended jobs, `1 jobs`, background drawing for every call,
errors drawn as starts, other tools wrapped, and no registration.

## `job_wait`

Added 2026-10-26 (subagents milestone 1, checkpoint 5). `job_wait({ ids, timeout_seconds? })` waits until every
listed job has ended, or the timeout (300 seconds by default, at most 1800), and returns what each job's notice would
have said: for a subagent, its whole answer. That notice then isn't sent, so the model doesn't get the result twice.
While it waits, the jobs' notices are reserved: a job that ends during the wait would otherwise send its notice
first, since that handler was registered earlier. A job still running at the timeout is reported, and its notice is
released to come later. Escape ends the wait, not the jobs. It's marked read-only, like `job_list`. The `background`
descriptions say to use it only when the model can't go on without the result.

Each job's notice builder is kept in `src/tool/jobs/notice.ts` (a `WeakMap` keyed by the job), which `noticeOnEnd`
fills and `takeNotice` reads, so `job_wait`, a single notice, and a subagent group all build the same text.

## Decided

- A `background` flag on a shell tool, not Codex's model: interactive programs are out.
- Override pi's `bash`, rather than a separate tool.
- The exit notice starts a turn when the agent is idle (OpenCode, Claude Code), rather than pi-unified-exec's opt-in.
- No time limit on background jobs; jobs end with the pi session, with no recovery after a restart.
- One notice path for every kind of job (2026-10-26, for subagents): `noticeOnEnd` and the notice moved to
  `src/tool/jobs/notice.ts`; a kind can pass its own text (a subagent's carries its whole answer). Whether the
  session has closed is `JobManager.closed`, set by `stopAll()`, not a flag in each tool.

## References

- pi: `docs/extensions.md` (lifecycle), `sendMessage` in `dist/core/extensions/types.d.ts`,
  `examples/extensions/bash-spawn-hook.ts`, `dist/core/tools/bash.d.ts`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/shell.ts`, `packages/core/src/job.ts`
- Codex (`openai/codex`, `main`): `codex-rs/core/src/tools/handlers/unified_exec/{exec_command,write_stdin}.rs`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) § Background commands, Monitor tool
- pi package: [pi-unified-exec](https://pi.dev/packages/pi-unified-exec)
