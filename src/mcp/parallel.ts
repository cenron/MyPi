import type { McpServer } from "./types";

/**
 * Parallel's free search server: keyless, read-only. Its web_fetch is hidden, since MyPi has its own. With
 * `PARALLEL_API_KEY` set, it sends the key as `Authorization: Bearer …` for higher limits; pi reads the variable when
 * it connects, so the key itself never appears here.
 */
export function parallelServer(): McpServer {
  return {
    name: "parallel",
    config: {
      url: "https://search.parallel.ai/mcp",
      description: "Web search through Parallel's free search service",
      exposure: "deferred",
      toolExposure: { web_fetch: "hidden" },
      // Only when set: pi fails to connect a server whose header names a missing variable.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
      ...(process.env.PARALLEL_API_KEY ? { headers: { Authorization: "Bearer ${PARALLEL_API_KEY}" } } : {}),
    },
  };
}
