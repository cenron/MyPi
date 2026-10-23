import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import { exaServer } from "./exa";
import { parallelServer } from "./parallel";
import type { McpServer } from "./types";

/** Registers MyPi's MCP servers with pi. One that pi rejects is logged, and the rest still register. */
export function registerMcpServers(pi: ExtensionAPI, session: Session): void {
  for (const mcp of createMcpServers()) {
    try {
      pi.registerMcpServer(mcp.name, mcp.config);
    } catch (error) {
      session.logError(`MCP server ${mcp.name}: ${errorMessage(error)}`);
    }
  }
}

/** MyPi's MCP servers. Add new ones here. */
function createMcpServers(): McpServer[] {
  return [parallelServer(), exaServer()];
}
