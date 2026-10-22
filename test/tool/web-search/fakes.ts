import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

/** What pi's `executeTool` returns for one call, less the `toolCall`. */
type Answer = { isError: boolean; result: { content: { type: "text"; text: string }[]; structuredContent?: unknown } };

/**
 * Pi's answer for an MCP call that worked: `structuredContent` holds the whole MCP result, `call`, and `content` the
 * model's copy, which pi may have cut. The copy here is a placeholder, so a test can tell which one was read.
 */
export const answered = (call: Record<string, unknown>): Answer => ({
  isError: false,
  result: { content: [{ type: "text", text: "the model's copy" }], structuredContent: call },
});

/** Pi's answer for a call that failed with `text`. */
export const failed = (text: string): Answer => ({ isError: true, result: { content: [{ type: "text", text }] } });

/** A `ctx` whose `executeTool` answers each tool from `answers`. A tool not listed isn't found, as in pi. */
export function fakeContext(answers: Record<string, Answer> = {}) {
  const executeTool = vi.fn(async (name: string, _args: Record<string, unknown>) => ({
    toolCall: {},
    ...(answers[name] ?? failed(`Tool ${name} not found`)),
  }));
  return { ctx: { executeTool } as unknown as ExtensionToolContext, executeTool };
}
