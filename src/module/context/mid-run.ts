import type { ContextEvent } from "@earendil-works/pi-coding-agent";

type AgentMessage = ContextEvent["messages"][number];

/** Put before a message the user sent while the agent was working, in the model's copy only. */
export const MID_RUN_NOTE =
  "The user sent this while you were working. Acknowledge it in one short line, say what changes because of it, " +
  "then continue:";

/**
 * The messages with each one the user sent mid-run marked for the model: a user message right after a tool result
 * arrived while the agent was still working (pi delivers it between tool calls). Unmarked, the model folds it in
 * without a word, so the user can't tell it was read. The transcript the user sees is unchanged.
 */
export function withMidRunNotes(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message, index) => {
    if (message.role !== "user" || messages[index - 1]?.role !== "toolResult") return message;

    const content =
      typeof message.content === "string"
        ? `${MID_RUN_NOTE}\n\n${message.content}`
        : [{ type: "text" as const, text: MID_RUN_NOTE }, ...message.content];
    return { ...message, content };
  });
}
