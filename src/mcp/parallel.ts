import { searchServer } from "./search-server";

const PARALLEL = {
  name: "parallel",
  url: "https://search.parallel.ai/mcp",
  description: "Web search through Parallel's free search service",
  hiddenTools: ["web_fetch"],
  key: { variable: "PARALLEL_API_KEY", header: "Authorization", prefix: "Bearer " },
};

/** Parallel's free search server; an API key raises its limits. */
export function parallelServer() {
  return searchServer(PARALLEL);
}
