import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobInfo } from "#core/types";
import { formatNotice, jobNotice, NoticeGroup, noticeOnEnd, takeNotice } from "#tool/jobs/notice";
import { fakeSession } from "../../fakes";

/** A job that completed after 3 seconds; rows change what they test. */
const job = (over: Partial<JobInfo> = {}): JobInfo => ({
  id: "1",
  kind: "shell",
  label: "npm run build",
  status: "completed",
  startedAt: 1_000,
  endedAt: 4_000,
  exitCode: 0,
  logPath: "/tmp/pi-job-1.log",
  ...over,
});

describe("jobNotice", () => {
  it.each([
    [
      "a completed job, with its last lines",
      job(),
      "built\ndone",
      "Background job 1 completed (exit code 0) after 3.0s: npm run build\nLast lines:\nbuilt\ndone\n" +
        "Full output: /tmp/pi-job-1.log",
    ],
    [
      "a failed exit code",
      job({ status: "failed", exitCode: 3 }),
      "boom",
      "Background job 1 failed (exit code 3) after 3.0s: npm run build\nLast lines:\nboom\nFull output: /tmp/pi-job-1.log",
    ],
    [
      "a command that couldn't run, with no output",
      job({ status: "failed", exitCode: undefined, error: "spawn /bin/sh ENOENT" }),
      "",
      "Background job 1 failed after 3.0s: npm run build\nError: spawn /bin/sh ENOENT\nNo output.\n" +
        "Full output: /tmp/pi-job-1.log",
    ],
  ])("%s", (_rule, info, tail, expected) => {
    expect(jobNotice(info, tail).content).toBe(expected);
  });

  it("strips escape codes and keeps the last 2,000 characters, in the text and the details", () => {
    const { content, details } = jobNotice(job(), `\x1b[32m${"x".repeat(3_000)}\x1b[39m`);
    expect(details.tail).toBe("x".repeat(2_000));
    expect(content).toContain(`Last lines:\n${"x".repeat(2_000)}\n`);
  });
});

describe("formatNotice", () => {
  const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` } as unknown as Theme;

  it("shows how the job ended in one line, with its last lines when expanded", () => {
    const failed = jobNotice(job({ status: "failed", exitCode: 3 }), "one\ntwo").details;
    expect(formatNotice(failed, false, theme)).toBe(
      "<error>job 1 failed</error><muted> · exit 3 · 3.0s · npm run build</muted> <dim>(ctrl+o to expand)</dim>",
    );
    expect(formatNotice(failed, true, theme)).toBe(
      "<error>job 1 failed</error><muted> · exit 3 · 3.0s · npm run build</muted>\n" +
        "<toolOutput>one</toolOutput>\n<toolOutput>two</toolOutput>",
    );
  });
});

afterEach(() => vi.useRealTimers());

describe("NoticeGroup", () => {
  it("groups successful notices after three seconds of quiet", async () => {
    vi.useFakeTimers();
    const { session, sendMessage } = fakeSession();
    const group = new NoticeGroup(session, 3_000);
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const first = session.jobs.start({
      kind: "subagent",
      label: "one",
      run: () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(0);
        }),
    });
    const second = session.jobs.start({
      kind: "subagent",
      label: "two",
      run: () =>
        new Promise((resolve) => {
          finishSecond = () => resolve(0);
        }),
    });
    noticeOnEnd(session, first, undefined, group);
    noticeOnEnd(session, second, undefined, group);
    finishFirst?.();
    await first.done;
    await vi.advanceTimersByTimeAsync(2_000);
    finishSecond?.();
    await second.done;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sendMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain("Background job 1 completed");
    expect(sendMessage.mock.calls[0]?.[0].content).toContain("Background job 2 completed");
  });

  it("sends failures immediately without flushing successful notices", async () => {
    vi.useFakeTimers();
    const { session, sendMessage } = fakeSession();
    const group = new NoticeGroup(session, 3_000);
    const success = session.jobs.start({ kind: "subagent", label: "success", run: async () => 0 });
    const failure = session.jobs.start({ kind: "subagent", label: "failure", run: async () => 1 });
    noticeOnEnd(session, success, undefined, group);
    noticeOnEnd(session, failure, undefined, group);
    await Promise.all([success.done, failure.done]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0].content).toContain("failure");
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0].content).toContain("success");
  });

  it("omits taken jobs and sends nothing after the session closes", async () => {
    vi.useFakeTimers();
    const { session, sendMessage } = fakeSession();
    const group = new NoticeGroup(session, 3_000);
    const taken = session.jobs.start({ kind: "subagent", label: "taken", run: async () => 0 });
    const pending = session.jobs.start({ kind: "subagent", label: "pending", run: async () => 0 });
    noticeOnEnd(session, taken, undefined, group);
    noticeOnEnd(session, pending, undefined, group);
    await Promise.all([taken.done, pending.done]);
    takeNotice(taken);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0].content).not.toContain("taken");

    const closingGroup = new NoticeGroup(session, 3_000);
    const closing = session.jobs.start({ kind: "subagent", label: "closing", run: async () => 0 });
    noticeOnEnd(session, closing, undefined, closingGroup);
    await closing.done;
    session.jobs.stopAll();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("noticeOnEnd", () => {
  // A job can finish on its own as the session closes: its exit code wins over the stop, but the session is gone.
  it("sends nothing for a job that completes after the session closed", async () => {
    const { session, sendMessage } = fakeSession();
    const ended = session.jobs.start({ kind: "shell", label: "true", run: async () => 0 });
    noticeOnEnd(session, ended);
    session.jobs.stopAll();

    expect(await ended.done).toMatchObject({ status: "completed" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
