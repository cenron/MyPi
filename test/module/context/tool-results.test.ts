import type { Message as AgentMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { oldResultsToClear, withResultsCleared } from "#module/context/tool-results";

function toolResult(id: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  };
}

function user(): AgentMessage {
  return { role: "user", content: "next", timestamp: 0 };
}

const big = "x".repeat(40_001);

describe("oldResultsToClear", () => {
  it.each([
    ["old large results, as a batch", [toolResult("a", big), toolResult("b", big)], new Set(), ["a", "b"]],
    [
      "not a small one beside them",
      [toolResult("a", big), toolResult("s", "x".repeat(8_000)), toolResult("b", big)],
      new Set(),
      ["a", "b"],
    ],
    [
      "not one from the last 3 user turns",
      [toolResult("a", big), toolResult("b", big), user(), toolResult("c", big), user(), user()],
      new Set(),
      ["a", "b"],
    ],
    ["nothing below the batch size", [toolResult("a", "x".repeat(79_999))], new Set(), []],
    ["nothing already cleared", [toolResult("a", big), toolResult("b", big)], new Set(["a"]), []],
  ])("clears %s", (_name, messages, cleared, expected) => {
    expect(oldResultsToClear(messages as AgentMessage[], cleared as Set<string>)).toEqual(expected);
  });
});

describe("withResultsCleared", () => {
  it("stubs tool calls with their path or one-line command and preserves other messages", () => {
    const other = user();
    const assistant: AgentMessage = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "r", name: "read", arguments: { path: "src/a.ts" } },
        { type: "toolCall", id: "b", name: "bash", arguments: { command: "git status\nprintf x" } },
      ],
      api: "",
      provider: "",
      model: "",
      usage: {} as never,
      stopReason: "stop",
      timestamp: 0,
    };
    const read = toolResult("r", "one\ntwo");
    const bash = { ...toolResult("b", "output"), toolName: "bash" };
    const unchanged = { role: "custom" } as unknown as AgentMessage;
    const result = withResultsCleared([other, assistant, read, bash, unchanged], new Set(["r", "b"]));

    expect(result[0]).toBe(other);
    expect(result[1]).toBe(assistant);
    expect(result[4]).toBe(unchanged);
    expect((result[2] as Extract<AgentMessage, { role: "toolResult" }>).content[0]).toEqual({
      type: "text",
      text: "[cleared to save context: read src/a.ts (2 lines). Call it again if you need it.]",
    });
    const bashStub = (result[3] as Extract<AgentMessage, { role: "toolResult" }>).content[0];
    expect(bashStub?.type === "text" && bashStub.text).toContain("bash git status");
  });
});
