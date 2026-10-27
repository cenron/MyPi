import { describe, expect, it } from "vitest";
import { parseEntry } from "#module/analytics/entries";

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

const lines: [string, string, string | undefined, string, string][] = [
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

describe("parseEntry", () => {
  it.each(lines)("%s", (_name, line, id, thinking = "high", stopReason = "stop") => {
    const entry = parseEntry(line);
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
    expect(parseEntry(JSON.stringify({ ...header, version }))?.header).toEqual({
      id: "session-id",
      cwd: "/project",
      version,
    });
  });
});
