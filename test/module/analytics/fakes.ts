/** A transcript tool call with the metadata shared by parser and indexer tests. */
export function call(id: string, name: string, args: Record<string, unknown>) {
  return JSON.stringify({
    type: "message",
    id: `message-${id}`,
    parentId: null,
    timestamp: "2026-10-26T10:03:00.000Z",
    message: {
      role: "assistant",
      provider: "openai",
      model: "gpt-6-luna",
      thinkingLevel: "high",
      content: [{ type: "toolCall", id, name, arguments: args }],
    },
  });
}

/** A transcript tool result for a call built by `call`. */
export function result(id: string, isError: boolean, text: string) {
  return JSON.stringify({
    type: "message",
    id: `result-${id}`,
    parentId: `message-${id}`,
    timestamp: "2026-10-26T10:03:01.000Z",
    message: { role: "toolResult", toolCallId: id, toolName: "bash", isError, content: [{ type: "text", text }] },
  });
}
