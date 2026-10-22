import { describe, expect, it } from "vitest";
import { registerMcpServers } from "#mcp/index";
import { parallelServer } from "#mcp/parallel";
import { fakeSession } from "../fakes";

describe("registerMcpServers", () => {
  it("registers each server with its config", () => {
    const { session, mcpServers } = fakeSession();
    registerMcpServers(session.pi, session);
    expect(mcpServers.get("parallel")).toEqual(parallelServer.config);
  });

  // Pi throws for an invalid config or a name another extension registered; that mustn't stop the session starting.
  it("logs a server pi rejects instead of throwing", () => {
    const { session, registerMcpServer, notify } = fakeSession();
    registerMcpServer.mockImplementationOnce(() => {
      throw new Error('MCP server "parallel" is already registered by extension "other"');
    });
    expect(() => registerMcpServers(session.pi, session)).not.toThrow();
    expect(notify).toHaveBeenCalledWith(
      'MCP server parallel: MCP server "parallel" is already registered by extension "other"',
      "error",
    );
  });
});
