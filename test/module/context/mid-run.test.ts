import type { Message as AgentMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { MID_RUN_NOTE, withMidRunNotes } from "#module/context/mid-run";

const toolResult: AgentMessage = {
  role: "toolResult",
  toolCallId: "call-1",
  toolName: "bash",
  content: [{ type: "text", text: "(no output)" }],
  isError: false,
  timestamp: 0,
};
const assistant: AgentMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Done." }],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-6-luna",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 0,
};

function user(content: Extract<AgentMessage, { role: "user" }>["content"]): AgentMessage {
  return { role: "user", content, timestamp: 0 };
}

describe("withMidRunNotes", () => {
  it("marks a user message that arrived right after a tool result, in text form", () => {
    const [, marked] = withMidRunNotes([toolResult, user("also print the date")]);
    expect(marked).toEqual(user(`${MID_RUN_NOTE}\n\nalso print the date`));
  });

  it("marks one in parts form, keeping its parts after the note", () => {
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
    const [, marked] = withMidRunNotes([toolResult, user([{ type: "text", text: "look at this" }, image])]);
    expect(marked).toEqual(user([{ type: "text", text: MID_RUN_NOTE }, { type: "text", text: "look at this" }, image]));
  });

  it.each([
    ["the first message", [user("hello")]],
    ["a message after the agent's reply (a new turn or a follow-up)", [toolResult, assistant, user("next")]],
  ])("leaves %s as it was", (_case, messages) => {
    expect(withMidRunNotes(messages)).toEqual(messages);
  });
});
