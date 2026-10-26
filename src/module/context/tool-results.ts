import type { ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";

type AgentMessage = ContextEvent["messages"][number];

/** A result smaller than this (about 2k tokens) is never worth clearing. */
const MIN_RESULT_CHARS = 8_000;
/** The current task's turns, whose results stay whole. */
const KEEP_USER_TURNS = 3;
/** Results are cleared in batches this big (about 20k tokens), so the prompt cache rebuilds once per batch. */
const BATCH_CHARS = 80_000;
/** An image counts as a large result. */
const IMAGE_CHARS = BATCH_CHARS;

/**
 * The tool-call IDs of large results from before the last few user turns, not cleared yet; none until together they
 * make a batch.
 */
export function oldResultsToClear(messages: AgentMessage[], cleared: ReadonlySet<string>): string[] {
  const recentStart = recentTurnStart(messages);
  const candidates: ToolResultMessage[] = [];
  let totalChars = 0;

  for (let index = 0; index < recentStart; index++) {
    const message = messages[index];
    if (message?.role !== "toolResult" || cleared.has(message.toolCallId)) {
      continue;
    }

    const size = resultSize(message);
    if (size <= MIN_RESULT_CHARS) {
      continue;
    }
    candidates.push(message);
    totalChars += size;
  }

  return totalChars >= BATCH_CHARS ? candidates.map((result) => result.toolCallId) : [];
}

/** The messages with each cleared result replaced by a stub naming its call; every other message as it was. */
export function withResultsCleared(messages: AgentMessage[], cleared: ReadonlySet<string>): AgentMessage[] {
  const calls = new Map<string, ToolCall>();
  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const block of message.content) {
      if (block.type === "toolCall") {
        calls.set(block.id, block);
      }
    }
  }

  return messages.map((message) => {
    if (message.role !== "toolResult" || !cleared.has(message.toolCallId)) {
      return message;
    }
    const call = calls.get(message.toolCallId);
    const label = call ? callLabel(call) : message.toolName;
    const lines = message.content.reduce(
      (count, block) => count + (block.type === "text" ? block.text.split("\n").length : 0),
      0,
    );
    return {
      ...message,
      content: [
        { type: "text", text: `[cleared to save context: ${label} (${lines} lines). Call it again if you need it.]` },
      ],
    };
  });
}

function recentTurnStart(messages: AgentMessage[]): number {
  let userTurns = 0;
  let earliestUser = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    earliestUser = index;
    if (++userTurns === KEEP_USER_TURNS) {
      return index;
    }
  }
  return earliestUser;
}

function resultSize(message: ToolResultMessage): number {
  return message.content.reduce((size, block) => size + (block.type === "text" ? block.text.length : IMAGE_CHARS), 0);
}

function callLabel(call: ToolCall): string {
  const { path, command } = call.arguments;
  if (typeof path === "string") return `${call.name} ${path}`;
  if (typeof command === "string") return `${call.name} ${command.split("\n", 1)[0]}`;

  return call.name;
}
