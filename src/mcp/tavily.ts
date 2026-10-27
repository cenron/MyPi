import type { McpServer } from "./types";

/** Tavily's hosted MCP hit its monthly keyless cap for MyPi, so it registers only with a key. */
export function tavilyServer(): McpServer | undefined {
  if (!process.env.TAVILY_API_KEY) return undefined;

  return {
    name: "tavily",
    config: {
      url: "https://mcp.tavily.com/mcp/",
      description: "Web search through Tavily",
      exposure: "deferred",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
      headers: { Authorization: "Bearer ${TAVILY_API_KEY}" },
    },
  };
}
