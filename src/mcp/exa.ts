import type { McpServer } from "./types";

/**
 * Exa's free search server: keyless, read-only. Its web_fetch_exa is hidden, since MyPi has its own web_fetch. With
 * `EXA_API_KEY` set, it sends the key as `x-api-key`, as `parallelServer` does. Exa documents `?exaApiKey=` in the
 * URL, but pi doesn't resolve variables there, and `/mcp` shows the URL.
 */
export function exaServer(): McpServer {
  return {
    name: "exa",
    config: {
      url: "https://mcp.exa.ai/mcp",
      description: "Web search through Exa's free search service",
      exposure: "deferred",
      toolExposure: { web_fetch_exa: "hidden" },
      // Only when set: pi fails to connect a server whose header names a missing variable.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
      ...(process.env.EXA_API_KEY ? { headers: { "x-api-key": "${EXA_API_KEY}" } } : {}),
    },
  };
}
