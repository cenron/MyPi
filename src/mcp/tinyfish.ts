import type { McpServer } from "./types";

/** TinyFish's search MCP works keyless as MyPi; a key replaces, rather than supplements, its keyless header. */
export function tinyfishServer(): McpServer {
  const headers: Record<string, string> = process.env.TINYFISH_API_KEY
    ? {
        // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
        "X-API-Key": "${TINYFISH_API_KEY}",
      }
    : { "X-TinyFish-Access-Mode": "keyless" };

  return {
    name: "tinyfish",
    config: {
      url: "https://agent.tinyfish.ai/mcp",
      description: "Web search through TinyFish",
      exposure: "deferred",
      headers,
    },
  };
}
