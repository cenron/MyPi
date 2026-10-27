# MCP servers

**Status:** done (2026-10-22): the registry and Parallel, Exa, and optional keys, all verified live

MyPi ships a list of MCP servers and registers them with pi on every `session_start`, the way it registers its
built-in tools. Pi's own MCP client does the rest, so MyPi has no MCP client code: only the list and the loop that
registers it.

## Goal

Hosted MCP servers that MyPi's tools build on, or that are worth having in every session, available out of the box
with no `mcp.json` entry. Parallel comes first, for [web_search](../tools/web-search.md).

Not the goal: MyPi serving tools over MCP itself. A shared endpoint with modules plugged into it would outlive every
pi session, and pi loads MyPi once per session, in every window, so two windows would fight over the port. Pi's
extension guide also says not to start long-lived processes from an extension. That idea belongs in its own project,
an always-on hub that pi reaches through `mcp.json` like any other server. MyPi keeps its tools' logic in plain
functions (`fetchPage`, `htmlToMarkdown`) so such a hub could wrap them later.

## What pi offers

Checked against the installed pi 1.2.0 (`docs/mcp.md`, `docs/extensions.md`, `dist/extensions/mcp/index.js`):

- `pi.registerMcpServer(name, config)` takes the shape of an `mcp.json` entry (`McpServerConfig`, exported as a
  type). The built-in MCP extension connects it: a server registered before its `session_start` runs is read there,
  and one registered after is connected by its `mcp_servers_change` handler. So MyPi's order against it doesn't
  matter.
- Pi handles the connection, OAuth, `${ENV}` and `!command` values in `headers`, and the server log
  (`~/.pi/agent/mcp.log`). It retries connecting twice on network errors and HTTP 408, 429, and 5xx, and a read-only
  request once. It never retries a tool call, since the call may have run: a 429 comes back as an error result,
  `MCP HTTP request failed with status 429: <body>` (`withClient` in `dist/extensions/mcp/runtime.js`).
- `/mcp` lists a registered server with MyPi as its source, and can reconnect it, turn it off, or change its exposure
  for the current session.
- The resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) come with it, for
  every server that has resources.
- Tools are named `mcp__<server>__<tool>`. `pi.getAllTools()` carries the annotations the server declares, so
  `ToolGuard` and plan-build's rule treat them like any tool. Calls go through `tool_call`, including calls a tool
  makes with `ctx.executeTool()`.
- A server that offers resources gets pi's resource tools at its own exposure, so a `deferred` server's resource
  tools are loaded through `tool_search` too, not declared up front.
- Text results over 20 KB reach the model cut in the middle, with the full text saved to a temp file. A tool calling
  through `ctx.executeTool()` gets the whole result, `structuredContent` included.
- `exposure` decides how the model reaches a server's tools: `direct` (declared), `deferred` (loaded by
  `tool_search`), `codemode` (called from scripts, the default), or `hidden` (unreachable, even through
  `ctx.executeTool()`). `toolExposure` overrides it per tool. A `deferred` or `codemode` server turns on
  `tool_search` or `codemode`, and lists the server in the `mcp_servers` system prompt section.
- `registerMcpServer` throws on an invalid config, on a name another extension registered, and on a name that differs
  from a registered one only in `-` and `_`. An `mcp.json` server with the same name wins, and `/mcp` shows the
  override.
- The registry belongs to the extension runtime (`createExtensionRuntime` in `dist/core/extensions/loader.js`), and
  `/reload` builds a new runtime, so a server MyPi stops registering is gone after `/reload`. Checked live: with the
  list emptied, `/reload` left `/mcp` showing no servers.

## Rules for every server

- Works with every model. Search services that support keyless access are registered without a key; integrations whose
  free tier is exhausted register only when their key is set.
- Sets `exposure` explicitly, and hides the tools MyPi already has (`toolExposure: { tool: "hidden" }`).
- Sets `description`, so the `mcp_servers` section and `tool_search` say what it offers.
- Keys, when a server takes one, go in `headers` as `${ENV}` or `!command`, never as values in tracked files.

## Design in pi

| Piece | Where | Notes |
|---|---|---|
| `McpServer` | `src/mcp/types.ts` | `{ name: string; config: McpServerConfig }` |
| A server | `src/mcp/<name>.ts`, exporting a function that returns a `McpServer` | A function, so a key header goes in only when its variable is set (see [Keys](#keys)). No `session` parameter until a server needs one. |
| The list | `createMcpServers()` in `src/mcp/index.ts` | Add new servers here. |
| Registering | `registerMcpServers(pi, session)` in `src/mcp/index.ts`, called last in `MyPi.onSessionStart` | Builds its own list, like `registerTools`. One `pi.registerMcpServer` per server, in a try/catch: a rejected server is logged with `session.logError("MCP server <name>: <message>")`, and the rest still register, as in `shutdownTools`. Nothing is unregistered; `/reload` builds a new runtime. |
| Names | Plain (`parallel`, not `mypi-parallel`) | So an `mcp.json` entry of the same name overrides it on purpose. |
| Import alias | `#mcp/*` → `./src/mcp/*.ts` in `package.json` | Restart pi after adding it: `/reload` keeps the old import map. |
| Modules | No `mcpServers()` hook yet | Added to `Module` and `BaseModule` when a module first needs one, like the other SDK helpers. |

## Servers

| Server | Status | Endpoint | Exposure | Used by |
|---|---|---|---|---|
| parallel | done | `https://search.parallel.ai/mcp` | `deferred`; its `web_fetch` hidden | [web_search](../tools/web-search.md) |
| exa | done | `https://mcp.exa.ai/mcp` | `deferred`; its `web_fetch_exa` hidden | [web_search](../tools/web-search.md), as fallback |
| tinyfish | done | `https://agent.tinyfish.ai/mcp` | `deferred` | [web_search](../tools/web-search.md), as fallback |
| tavily | done (key required) | `https://mcp.tavily.com/mcp/` | `deferred` | [web_search](../tools/web-search.md), as fallback |

A server gets its own doc here only once it needs design of its own.

### parallel

```ts
export function parallelServer(): McpServer {
  return {
    name: "parallel",
    config: {
      url: "https://search.parallel.ai/mcp",
      description: "Web search through Parallel's free search service",
      exposure: "deferred",
      toolExposure: { web_fetch: "hidden" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
      ...(process.env.PARALLEL_API_KEY ? { headers: { Authorization: "Bearer ${PARALLEL_API_KEY}" } } : {}),
    },
  };
}
```

Checked live (2026-10-21): no key and no handshake needed. `web_search` and `web_fetch` both declare
`readOnlyHint: true` and `openWorldHint: true`. `deferred` turns on `tool_search`, and the model can load
`mcp__parallel__web_search` directly as well as through web_search.

Live in pi (2026-10-22): `/mcp` shows `connected · 2 tools · resources · deferred · extension`, with `web_fetch`
marked `[hidden]` (the count includes it). In Plan mode the model loaded the tool with `tool_search` and searched with
no permission prompt, since plan-build's rule reads the server's `readOnlyHint`. The result, about 5.3k tokens, was
cut by pi's 20 KB limit for the model.

### exa

```ts
export function exaServer(): McpServer {
  return {
    name: "exa",
    config: {
      url: "https://mcp.exa.ai/mcp",
      description: "Web search through Exa's free search service",
      exposure: "deferred",
      toolExposure: { web_fetch_exa: "hidden" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: pi resolves ${ENV} in headers when it connects.
      ...(process.env.EXA_API_KEY ? { headers: { "x-api-key": "${EXA_API_KEY}" } } : {}),
    },
  };
}
```

Checked live (2026-10-22): no key and no handshake needed. `web_search_exa` and `web_fetch_exa` declare
`readOnlyHint: true` and `openWorldHint: true`. `web_search_exa` requires `query` and `objective`, and replies in text
only, with no `structuredContent`. Its old `get_code_context_exa` tool is gone from the keyless server.

Live in pi (2026-10-22): `/reload` registered it (no restart needed, since `package.json` didn't change). `/mcp` shows
`connected · 2 tools · resources · deferred · extension`, with `web_fetch_exa` marked `[hidden]`.

## Keys

Parallel, Exa, and TinyFish work without a key; a key only raises the service's limits. MyPi reads these environment
variables at each `session_start`:

| Variable | Header MyPi adds |
|---|---|
| `PARALLEL_API_KEY` | `Authorization: Bearer ${PARALLEL_API_KEY}` |
| `EXA_API_KEY` | `x-api-key: ${EXA_API_KEY}` |
| `TINYFISH_API_KEY` | `X-API-Key: ${TINYFISH_API_KEY}` (replaces its keyless access header) |
| `TAVILY_API_KEY` | `Authorization: Bearer ${TAVILY_API_KEY}` (Tavily registers only when set) |

- The header names the variable, and pi resolves it when it connects (`resolveHeadersOrThrow` in
  `dist/extensions/mcp/runtime.js`), so the key never appears in MyPi's code, its config, `/mcp`, or a log.
- MyPi adds a header only when the variable is set and not empty: pi fails to connect a server whose header names a
  missing variable, which would break keyless use.
- Pi resolves variables only in `headers`, not in `url`. That rules out Exa's documented `?exaApiKey=`, which would
  put the key itself in the config and on screen in `/mcp`.
- With an `Authorization` header, pi doesn't try OAuth. A wrong key fails the connection, and web_search falls back
  to the other server.
- The variables come from pi's own environment: set them before starting pi, and restart it after a change.
- Tavily's keyless MCP search connected but returned the monthly keyless-cap error on 2026-10-27; MyPi therefore
  registers it only with `TAVILY_API_KEY`. The documented keyless Tavily REST API is a possible later backend, not
  used now.
- TinyFish's keyless MCP search worked from MyPi on 2026-10-27. It uses `X-TinyFish-Access-Mode: keyless`; with a
  key, MyPi sends only `X-API-Key`.
- On 2026-10-27, deferred search tools let a model discover and call the backend directly when `web_search` failed.
  `web_search` owns a rule that allows those calls only as nested calls from that tool; see its
  [design](../tools/web-search.md#design-in-pi). `ToolGuard` resolves nested parent tool names from pi's
  `parentToolCallId` and clears them on `tool_execution_end`.
- Anything else (a `!command` key from a password manager, another exposure) goes in a full server entry in
  `~/.pi/agent/mcp.json`, which replaces MyPi's.

## Slices

1. **Done.** The registry and Parallel: `McpServer`, `registerMcpServers`, `parallelServer`, the `#mcp/*` alias, and the call
   in `MyPi.onSessionStart`.
   - Tests (wiring only): `test/mcp/index.test.ts` checks a server is registered with its config, and one pi rejects
     is logged by name instead of throwing. `test/index.test.ts` checks a session start registers
     `parallel`. `test/fakes.ts` and the extension fake in `test/index.test.ts` get `registerMcpServer`.
     Pi doesn't export `validateMcpServerConfig`, so the config itself is checked live.
   - Live test after restarting pi: `/mcp` lists `parallel` from MyPi, connected with 1 tool; `tool_search` is
     active; the model can search through it. Then drop it from the list and `/reload` to confirm it's gone.
   - Docs: an MCP servers section and a startup flow line in `architecture.md`, a row and the alias in
     `project-structure.md` and the AGENTS.md map.
2. **Done.** Exa (2026-10-22), for web_search's fallback: `exaServer` in `src/mcp/exa.ts`, added to
   `createMcpServers()`. The registry test now checks both servers register, and that a server pi rejects doesn't
   stop the next.
3. **Done.** Optional keys (2026-10-22), for web_search's slice 5: `parallelServer()` and `exaServer()` became
   functions that add a key header when `PARALLEL_API_KEY` or `EXA_API_KEY` is set. See [Keys](#keys). Tests: an
   "API keys" table in `test/mcp/index.test.ts`, using `vi.stubEnv`. Live: with `PARALLEL_API_KEY=bogus`, Parallel
   failed with `MCP server requires authentication` and web_search answered from Exa; without it, both connected.

## Open questions

- Should a server's `config` come from settings later (on or off, a key), or is `/mcp` for the session enough?
