import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

/** An MCP server MyPi registers on every session_start. Pi connects it, and `/mcp` lists it with MyPi as its source. */
export type McpServer = { name: string; config: McpServerConfig };
