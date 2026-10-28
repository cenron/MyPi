import { searchServer } from "./search-server";

const TAVILY = {
  name: "tavily",
  url: "https://mcp.tavily.com/mcp/",
  description: "Web search through Tavily",
  key: { variable: "TAVILY_API_KEY", header: "Authorization", prefix: "Bearer " },
  requiresKey: true as const,
};

/** Tavily's hosted MCP hit its monthly keyless cap, so MyPi registers it only with a key. */
export function tavilyServer() {
  return searchServer(TAVILY);
}
