import { describe, expect, it } from "vitest";
import { DONE_CHECK_NOTICE, JOB_NOTICE } from "#core/job-notice";
import { parseEntry, type ToolCallRow, type ToolResultRow } from "#module/analytics/entries";
import { call as callLine, result as resultLine } from "./fakes";

const HOME = "/home/user";
const usage = {
  input: 100,
  output: 20,
  cacheRead: 40,
  cacheWrite: 5,
  cost: { total: 0.01 },
};
const header = {
  type: "session",
  version: 3,
  id: "session-id",
  timestamp: "2026-10-26T10:00:00.000Z",
  cwd: "/project",
};
const assistant = {
  type: "message",
  id: "reply-id",
  timestamp: "2026-10-26T10:01:00.000Z",
  message: {
    role: "assistant",
    provider: "openai",
    model: "gpt-6-luna",
    thinkingLevel: "high",
    usage,
    stopReason: "stop",
  },
};

const usageLines: [string, string, string | undefined, string, string][] = [
  [
    "assistant reply stores counts and metadata without its content",
    JSON.stringify(assistant),
    "assistant:reply-id",
    "high",
    "stop",
  ],
  [
    "usage entry stores counts",
    JSON.stringify({ ...assistant, type: "usage", provider: "openai", model: "gpt-6-luna", kind: "cache_warm", usage }),
    "usage:reply-id",
    "unknown",
    "unknown",
  ],
  [
    "user messages are ignored",
    JSON.stringify({ ...assistant, message: { role: "user" } }),
    undefined,
    "unknown",
    "unknown",
  ],
  ["malformed lines are ignored", "{broken", undefined, "unknown", "unknown"],
] as const;

const toolLines: [string, string, Partial<ToolCallRow> | ToolResultRow][] = [
  [
    "a bash call keeps each segment's command name",
    callLine("call-1", "bash", { command: "cd src && rg -n needle" }),
    {
      tool: "bash",
      commandNames: ["cd", "rg"],
      codeSearch: true,
      fromLineOne: false,
    },
  ],
  [
    "a search over node_modules is not a code search",
    callLine("call-1", "bash", { command: "grep -rn needle node_modules/pkg" }),
    {
      tool: "bash",
      commandNames: ["grep"],
      codeSearch: false,
      fromLineOne: false,
    },
  ],
  [
    "a command that names node_modules anywhere is not a code search",
    callLine("call-1", "bash", { command: "rg needle src && ls node_modules" }),
    {
      tool: "bash",
      commandNames: ["rg", "ls"],
      codeSearch: false,
      fromLineOne: false,
    },
  ],
  [
    "a command under the home folder is shortened",
    callLine("call-1", "bash", { command: "/home/user/bin/thing --flag" }),
    {
      tool: "bash",
      commandNames: ["~/bin/thing"],
      codeSearch: false,
      fromLineOne: false,
    },
  ],
  [
    "a read without an offset starts at line one",
    callLine("call-1", "read", { path: "src/a.ts" }),
    {
      tool: "read",
      fromLineOne: true,
    },
  ],
  [
    "a read with an offset starts later",
    callLine("call-1", "read", { path: "src/a.ts", offset: 40 }),
    {
      tool: "read",
      fromLineOne: false,
    },
  ],
  [
    "a failed result keeps a shortened first line",
    resultLine("call-1", true, "Error: /home/user/src/a.ts missing\nstack"),
    {
      callId: "call-1",
      failed: true,
      failureLine: "Error: ~/src/a.ts missing",
    },
  ],
  [
    "a successful result has no failure line",
    resultLine("call-1", false, "all good"),
    {
      callId: "call-1",
      failed: false,
    },
  ],
  [
    "a bash result ending in pi's non-zero status is an exit without a failure line",
    resultLine("call-1", true, "ls: /no/such/folder: missing\n\nCommand exited with code 2"),
    { callId: "call-1", failed: true, exited: true },
  ],
  [
    "a bash result with an earlier exit status remains a failure with its first line",
    resultLine("call-1", true, "Command exited with code 2\nmore output"),
    { callId: "call-1", failed: true, failureLine: "Command exited with code 2" },
  ],
];

describe("parseEntry", () => {
  it.each(usageLines)("%s", (_name, line, id, thinking = "high", stopReason = "stop") => {
    const entry = parseEntry(line, HOME);
    if (id === undefined) {
      expect(entry?.usage).toBeUndefined();
      return;
    }
    expect(entry?.usage).toMatchObject({
      entryId: id,
      isReply: id.startsWith("assistant:"),
      provider: "openai",
      model: "gpt-6-luna",
      thinking,
      input: 100,
      output: 20,
      cacheRead: 40,
      cacheWrite: 5,
      cost: 0.01,
      stopReason,
    });
  });

  it.each([1, 2, 3])("recognizes session headers from version %i", (version) => {
    expect(parseEntry(JSON.stringify({ ...header, version }), HOME)?.header).toEqual({
      id: "session-id",
      cwd: "/project",
      version,
      timestamp: Date.parse(header.timestamp),
    });
  });

  it.each(toolLines)("%s", (_name, line, expected) => {
    const entry = parseEntry(line, HOME);
    if (!("tool" in expected)) {
      expect(entry?.results).toEqual([expected]);
      return;
    }
    expect(entry?.calls?.[0]).toMatchObject({
      callId: "call-1",
      provider: "openai",
      model: "gpt-6-luna",
      thinking: "high",
      ...expected,
    });
  });

  it("cuts a failure line to 120 characters", () => {
    const entry = parseEntry(resultLine("call-1", true, "x".repeat(200)), HOME);
    expect(entry?.results?.[0]?.failureLine).toHaveLength(120);
  });

  it("ignores a result that names no call", () => {
    const line = JSON.stringify({ type: "message", message: { role: "toolResult", isError: true } });
    expect(parseEntry(line, HOME)?.results).toBeUndefined();
  });

  it.each([
    [
      "done-check report",
      DONE_CHECK_NOTICE,
      "Done check: 1 error in files changed during this run.",
      "done-check-report",
    ],
    ["done-check pass", DONE_CHECK_NOTICE, "Done check passed: tsc passed.", "done-check-pass"],
    ["job notice", JOB_NOTICE, "Job finished.", "job"],
  ] as const)("records the %s without keeping its content", (_name, customType, content, kind) => {
    const entry = parseEntry(
      JSON.stringify({
        type: "custom_message",
        id: "notice-1",
        timestamp: "2026-10-26T10:01:00.000Z",
        customType,
        content,
      }),
      HOME,
    );
    expect(entry?.features?.map(({ kind: recorded }) => recorded)).toEqual([kind]);
    expect(entry).not.toHaveProperty("content");
  });

  it("keeps the parent session path from a subagent header", () => {
    expect(parseEntry(JSON.stringify({ ...header, parentSession: "/sessions/parent.jsonl" }), HOME)?.header).toEqual({
      id: "session-id",
      cwd: "/project",
      version: 3,
      timestamp: Date.parse(header.timestamp),
      parentSession: "/sessions/parent.jsonl",
    });
  });

  it("keeps the agent name on a subagent tool call", () => {
    const entry = parseEntry(callLine("call-1", "subagent", { agent: "reviewer", task: "secret" }), HOME);
    expect(entry?.calls?.[0]?.agentName).toBe("reviewer");
    expect(entry?.calls?.[0]).not.toHaveProperty("task");
  });

  it("keeps no command names when tokenize gives up", () => {
    const entry = parseEntry(callLine("call-1", "bash", { command: "npm test > /tmp/out" }), HOME);
    expect(entry?.calls?.[0]?.commandNames).toEqual([]);
  });
});
