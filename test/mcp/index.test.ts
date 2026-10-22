import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exaServer } from "#mcp/exa";
import { registerMcpServers } from "#mcp/index";
import { parallelServer } from "#mcp/parallel";
import { fakeSession } from "../fakes";

/** The configs MyPi registers, by server name, with the environment as it is. */
function registered() {
  const { session, mcpServers } = fakeSession();
  registerMcpServers(session.pi, session);
  return mcpServers;
}

/** A config's headers; only HTTP servers have them. */
const headersOf = (config: McpServerConfig | undefined) => (config && "headers" in config ? config.headers : undefined);

// biome-ignore lint/suspicious/noTemplateCurlyInString: the configs hold pi's ${ENV} references, not values.
const PARALLEL_KEY = { Authorization: "Bearer ${PARALLEL_API_KEY}" };
// biome-ignore lint/suspicious/noTemplateCurlyInString: as above.
const EXA_KEY = { "x-api-key": "${EXA_API_KEY}" };

afterEach(() => vi.unstubAllEnvs());

describe("registerMcpServers", () => {
  it("registers each server with its config", () => {
    expect(registered()).toEqual(
      new Map([
        ["parallel", parallelServer().config],
        ["exa", exaServer().config],
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

// Pi resolves `${…}` in headers when it connects, so the configs name the variables, never their values.
describe("API keys", () => {
  it.each([
    ["no key header without the variables", {}, undefined, undefined],
    ["no key header for an empty variable", { PARALLEL_API_KEY: "", EXA_API_KEY: "" }, undefined, undefined],
    ["Parallel's key as a bearer token", { PARALLEL_API_KEY: "secret" }, PARALLEL_KEY, undefined],
    ["Exa's key as x-api-key", { EXA_API_KEY: "secret" }, undefined, EXA_KEY],
  ])("%s", (_rule, env: Record<string, string>, parallelHeaders, exaHeaders) => {
    vi.stubEnv("PARALLEL_API_KEY", undefined);
    vi.stubEnv("EXA_API_KEY", undefined);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    const servers = registered();
    expect(headersOf(servers.get("parallel"))).toEqual(parallelHeaders);
    expect(headersOf(servers.get("exa"))).toEqual(exaHeaders);
  });
});
