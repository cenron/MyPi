import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { callMcpTool } from "#tool/utils";
import type { SearchBackend, SearchResult } from "../types";

type McpBackendOptions = {
  id: string;
  name: string;
  tool: string;
  argumentsForQuery(query: string): Record<string, unknown>;
  parseReply(reply: Record<string, unknown>): SearchResult[];
};

/** Builds a backend whose search is one MCP call followed by that service's reply parser. */
export function mcpBackend(options: McpBackendOptions): SearchBackend {
  return {
    id: options.id,
    name: options.name,
    tool: options.tool,
    async search(ctx: ExtensionToolContext, query: string) {
      const reply = await callMcpTool(ctx, options.tool, options.argumentsForQuery(query));
      return options.parseReply(reply);
    },
  };
}
