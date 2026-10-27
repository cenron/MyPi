import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exaServer } from "#mcp/exa";
import { registerMcpServers } from "#mcp/index";
import { parallelServer } from "#mcp/parallel";
import { tinyfishServer } from "#mcp/tinyfish";
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
// biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
const TINYFISH_KEY = { "X-API-Key": "${TINYFISH_API_KEY}" };
const TINYFISH_KEYLESS = { "X-TinyFish-Access-Mode": "keyless" };
// biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
const TAVILY_KEY = { Authorization: "Bearer ${TAVILY_API_KEY}" };

afterEach(() => vi.unstubAllEnvs());

describe("registerMcpServers", () => {
  it("registers each server with its config", () => {
    expect(registered()).toEqual(
      new Map([
        ["parallel", parallelServer().config],
        ["exa", exaServer().config],
        ["tinyfish", tinyfishServer().config],
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
    expect([...mcpServers.keys()]).toEqual(["exa", "tinyfish"]);
  });
});

// Pi resolves `${…}` in headers when it connects, so the configs name the variables, never their values.
describe("API keys", () => {
  it.each([
    ["keyless services and no Tavily without a key", {}, undefined, undefined, TINYFISH_KEYLESS, undefined],
    [
      "empty variables keep keyless use and do not register Tavily",
      { PARALLEL_API_KEY: "", EXA_API_KEY: "", TINYFISH_API_KEY: "", TAVILY_API_KEY: "" },
      undefined,
      undefined,
      TINYFISH_KEYLESS,
      undefined,
    ],
    [
      "Parallel's key as a bearer token",
      { PARALLEL_API_KEY: "secret" },
      PARALLEL_KEY,
      undefined,
      TINYFISH_KEYLESS,
      undefined,
    ],
    ["Exa's key as x-api-key", { EXA_API_KEY: "secret" }, undefined, EXA_KEY, TINYFISH_KEYLESS, undefined],
    [
      "TinyFish's key replaces its keyless header",
      { TINYFISH_API_KEY: "secret" },
      undefined,
      undefined,
      TINYFISH_KEY,
      undefined,
    ],
    [
      "Tavily registers with its bearer key",
      { TAVILY_API_KEY: "secret" },
      undefined,
      undefined,
      TINYFISH_KEYLESS,
      TAVILY_KEY,
    ],
  ])("%s", (_rule, env: Record<string, string>, parallelHeaders, exaHeaders, tinyfishHeaders, tavilyHeaders) => {
    vi.stubEnv("PARALLEL_API_KEY", undefined);
    vi.stubEnv("EXA_API_KEY", undefined);
    vi.stubEnv("TINYFISH_API_KEY", undefined);
    vi.stubEnv("TAVILY_API_KEY", undefined);
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    const servers = registered();
    expect(headersOf(servers.get("parallel"))).toEqual(parallelHeaders);
    expect(headersOf(servers.get("exa"))).toEqual(exaHeaders);
    expect(headersOf(servers.get("tinyfish"))).toEqual(tinyfishHeaders);
    expect(headersOf(servers.get("tavily"))).toEqual(tavilyHeaders);
  });
});
