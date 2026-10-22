import type { McpServer } from "./types";

/** Parallel's free search server: keyless, read-only. Its web_fetch is hidden, since MyPi has its own. */
export const parallelServer: McpServer = {
  name: "parallel",
  config: {
    url: "https://search.parallel.ai/mcp",
    description: "Web search through Parallel's free search service",
    exposure: "deferred",
    toolExposure: { web_fetch: "hidden" },
  },
};
