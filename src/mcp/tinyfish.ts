import { searchServer } from "./search-server";

const TINYFISH = {
  name: "tinyfish",
  url: "https://agent.tinyfish.ai/mcp",
  description: "Web search through TinyFish",
  key: {
    variable: "TINYFISH_API_KEY",
    header: "X-API-Key",
    keylessHeader: { name: "X-TinyFish-Access-Mode", value: "keyless" },
  },
};

/** TinyFish's search MCP works keyless as MyPi; a key replaces its keyless header. */
export function tinyfishServer() {
  return searchServer(TINYFISH);
}
