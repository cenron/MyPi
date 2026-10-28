import { searchServer } from "./search-server";

const EXA = {
  name: "exa",
  url: "https://mcp.exa.ai/mcp",
  description: "Web search through Exa's free search service",
  hiddenTools: ["web_fetch_exa"],
  key: { variable: "EXA_API_KEY", header: "x-api-key" },
};

/** Exa's free search server; its duplicate page-fetch tool is hidden. */
export function exaServer() {
  return searchServer(EXA);
}
