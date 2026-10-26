import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { JobInfo } from "#core/types";
import { formatNotice, jobNotice, noticeOnEnd } from "#tool/jobs/notice";
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
