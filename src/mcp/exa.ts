import type { McpServer } from "./types";

/** Exa's free search server: keyless, read-only. Its web_fetch_exa is hidden, since MyPi has its own web_fetch. */
export const exaServer: McpServer = {
  name: "exa",
  config: {
    url: "https://mcp.exa.ai/mcp",
    description: "Web search through Exa's free search service",
    exposure: "deferred",
    toolExposure: { web_fetch_exa: "hidden" },
  },
};
