import { describe, expect, it } from "vitest";
import { exaServer } from "#mcp/exa";
import { registerMcpServers } from "#mcp/index";
import { parallelServer } from "#mcp/parallel";
import { fakeSession } from "../fakes";

describe("registerMcpServers", () => {
  it("registers each server with its config", () => {
    const { session, mcpServers } = fakeSession();
    registerMcpServers(session.pi, session);
    expect(mcpServers).toEqual(
      new Map([
        ["parallel", parallelServer.config],
        ["exa", exaServer.config],
      ]),
    );
  });

  // Pi throws for an invalid config or a name another extension registered; that mustn't stop the session starting.
  it("logs a server pi rejects, and registers the rest", () => {
    const { session, registerMcpServer, notify, mcpServers } = fakeSession();
    registerMcpServer.mockImplementationOnce(() => {
      throw new Error('MCP server "parallel" is already registered by extension "other"');
    });
    expect(() => registerMcpServers(session.pi, session)).not.toThrow();
    expect(notify).toHaveBeenCalledWith(
      'MCP server parallel: MCP server "parallel" is already registered by extension "other"',
      "error",
    );
    expect([...mcpServers.keys()]).toEqual(["exa"]);
  });
});
