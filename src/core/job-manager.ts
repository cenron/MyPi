import { createWriteStream, type WriteStream } from "node:fs";
import { DEFAULT_MAX_BYTES } from "@earendil-works/pi-coding-agent";
import type { JobInfo, JobSpec } from "#core/types";
import { errorMessage } from "./util/errors";
import { tempFilePath } from "./util/paths";

/** A started job: its info as it changes, a promise that settles once it has ended, and its last output lines. */
export type Job = { readonly info: JobInfo; readonly done: Promise<JobInfo>; tail(lines: number): string };

/** Most characters of output a job keeps in memory; the log file has the rest. pi's own output cap. */
const TAIL_CHARS = DEFAULT_MAX_BYTES;

/** A job and what only the registry touches: its stop switch. */
type Entry = Job & { controller: AbortController };

/**
 * The session's jobs: long-running work that goes on after the tool call that started it. Shell commands are the
 * first kind; subagents can be another. One per `Session`; `stopAll()` runs on `session_shutdown`.
 */
export class JobManager {
  private currentJobId = 1;
  private readonly jobs = new Map<string, Entry>();
  private readonly listeners = new Set<(running: number) => void>();

  /** Starts `spec` at once. Ids count up from 1 in this session. */
  start(spec: JobSpec): Job {
    const info = this.createJobInfo(spec);
    const log = this.createLogWriter(info.logPath);
    const decoder = new TextDecoder();
    let tail = "";

    // Writes each job-output chunk to the log and keeps its decoded tail in memory for previews.
    const write = (chunk: Buffer | string): void => {
      if (info.status !== "running") return;
      log.write(chunk);

      // `stream: true` holds back a character split across two chunks until the rest arrives.
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      tail = appendTail(tail, text);
    };

    const controller = new AbortController();
    const done = this.settle(spec, info, controller.signal, write, log).then(() => {
      tail = appendTail(tail, decoder.decode());
      this.notify();
      return info;
    });

    const entry: Entry = { info, done, controller, tail: (lines) => lastLines(tail, lines) };
    this.jobs.set(info.id, entry);
    this.notify();
    return entry;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Every job of this session, running or ended, oldest first. */
  list(): JobInfo[] {
    return [...this.jobs.values()].map((job) => ({ ...job.info }));
  }

  /** Stops a running job and waits for it to end. Undefined for an unknown id; an ended job is returned as is. */
  async stop(id: string): Promise<JobInfo | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    job.controller.abort();
    return job.done;
  }

  /**
   * Calls `listener` with the number of running jobs whenever a job starts or ends. Returns a function that removes
   * it. `stopAll()` drops every listener, since it runs only when the session ends.
   */
  onChange(listener: (running: number) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Stops every running job without waiting, so `session_shutdown` stays synchronous. Safe to call twice. Drops the
   * listeners first: the jobs end after the session has, when nothing should reach its UI.
   */
  stopAll(): void {
    this.listeners.clear();
    for (const job of this.jobs.values()) job.controller.abort();
  }

  /** Runs the job and records how it ended: an exit code, an error, or a stop. Never rejects. */
  private async settle(
    spec: JobSpec,
    info: JobInfo,
    signal: AbortSignal,
    write: (chunk: Buffer | string) => void,
    log: WriteStream,
  ): Promise<void> {
    // An exit code wins, even when a stop came in while it was on its way: the job had ended by then. A `run` that
    // throws after a stop was stopped (pi's `exec` throws "aborted").
    try {
      const exitCode = await spec.run(signal, write);
      Object.assign(info, { status: exitCode === 0 ? "completed" : "failed", exitCode });
    } catch (error) {
      if (signal.aborted) info.status = "stopped";
      else Object.assign(info, { status: "failed", error: errorMessage(error) });
    }
    info.endedAt = Date.now();
    await new Promise<void>((resolve) => log.end(resolve));
  }

  private notify() {
    const running = [...this.jobs.values()].filter((job) => job.info.status === "running").length;
    for (const listener of this.listeners) listener(running);
  }

  /** A new job's info: the next id, running from now, with a new log file. */
  private createJobInfo(spec: JobSpec): JobInfo {
    const jobInfo: JobInfo = {
      id: String(this.currentJobId),
      kind: spec.kind,
      label: spec.label,
      status: "running",
      startedAt: Date.now(),
      logPath: tempFilePath("pi-job", ".log"),
    };

    this.currentJobId++;
    return jobInfo;
  }

  private createLogWriter(logPath: string): WriteStream {
    const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
    // A log that can't be written mustn't crash pi; the job still runs, and its tail still fills.
    log.on("error", () => {});

    return log;
  }
}

/** `text` added to the end of `tail`, keeping only the last `TAIL_CHARS` characters. */
function appendTail(tail: string, text: string): string {
  return (tail + text).slice(-TAIL_CHARS);
}

/** The last `count` lines of `text`, without its final newline. */
function lastLines(text: string, count: number): string {
  const lines = text.replace(/\n$/, "").split("\n");
  return lines.slice(-count).join("\n");
}
