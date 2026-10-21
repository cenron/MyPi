# web_search

**Status:** building (registered as a stub that returns `TODO`, with its description and `promptSnippet`)

## Goal

Let the agent search the web with any model, including local ones. Pi 1.2.0 has no web search built in. No
provider-native search: the tool runs in MyPi and talks to search services that don't belong to a model provider.
Reading a page is the job of [web_fetch](web-fetch.md).

## What pi offers

Checked against the installed pi 1.2.0:

| Route | How | Verdict |
|---|---|---|
| An MCP server | `pi mcp add exa --url https://mcp.exa.ai/mcp`, or `pi.registerMcpServer(name, config)` from code | Works today with no code. Exa's hosted server needs no key for light use. Tools arrive as `mcp__<server>__<tool>`. |
| MyPi's own tool | `pi.registerTool({ name: "web_search", … })` calling a search service | Full control over the backend, output size, rendering, and annotations. |
| Provider-native search | Anthropic's `web_search` server tool or OpenAI's `web_search`, added through `before_provider_request` | Not possible: pi-ai 1.2.0 doesn't handle `server_tool_use` or `web_search_tool_result` blocks in replies (no match in `pi-ai/dist`). It would also only work for those two providers. |
| A pi package | `pi install npm:pi-agent-web-access` and similar | Works, but lives outside MyPi. Useful to read for ideas. |

## Other harnesses

| Harness | web_search |
|---|---|
| Claude Code | Anthropic server-side search (provider-native, so not an option) |
| Codex CLI | OpenAI-native, `cached` or `live` (provider-native, so not an option) |
| OpenCode | Its own tool over five search services, four of them keyless |

OpenCode is the model to copy. Read from its `dev` branch (`anomalyco/opencode`, 2026-10-20).

### OpenCode's web_search

Three layers:

1. **Tool** (`packages/core/src/tool/plugin/websearch.ts`)
   - Input is just `{ query }`.
   - The description says to use it for information past the knowledge cutoff and puts the current year in, so
     searches about recent things use the right year.
   - Permission is checked with the query as the resource.
   - **First-use consent:** when no backend is chosen yet, a form offers "Allow search via Exa, Parallel, …",
     "Choose another provider", or "Disable web search". The choice is stored. A lock makes parallel calls ask once.
   - Output is markdown, one block per result: `## [Title](url)`, an optional `Published:` line, then the excerpt.
     No results returns "No search results found. Please try a different query."
   - Errors become short messages, such as "Web search rate limited (HTTP 429)".
   - When search is disabled, a hook deletes the tool from every request, so the model never sees it.
2. **Service** (`packages/core/src/websearch.ts`)
   - Every backend is `execute({ query }) → Result[]`, where `Result` is `{ url, title?, content?, time: { published? } }`.
   - The selection is a backend ID, `"random"`, or `false` (off).
   - With `"random"`, each session sticks to one backend. On HTTP 429 that backend cools down for its `Retry-After`
     time (60 seconds if the header is missing), and the query retries on another one. If every backend is cooling
     down, the search fails. Any other error fails at once, with no retry.
3. **Backends** (`packages/core/src/plugin/websearch/*.ts`)
   - Most are hosted MCP servers, but OpenCode runs no MCP client. `mcp.ts` (about 60 lines) sends one JSON-RPC
     `tools/call` POST with `Accept: application/json, text/event-stream`. It reads the reply as plain JSON or from
     the first `data:` line of the event stream, caps it at 256 KB, and times out after 25 seconds.

| Backend | Endpoint | Remote tool | Without a key |
|---|---|---|---|
| Exa | `https://mcp.exa.ai/mcp` | `web_search_exa`, 8 results | Works. A key goes in as `?exaApiKey=`. |
| Parallel | `https://search.parallel.ai/mcp` | `web_search` with `{ objective, search_queries: [q] }` | Works. A key goes in as `Authorization: Bearer`. |
| TinyFish | `https://agent.tinyfish.ai/mcp` | `search` | Sends `X-TinyFish-Access-Mode: keyless`. With a key it must run MCP `initialize` first and send the `Mcp-Session-Id`. |
| Tavily | `https://api.tavily.com/search` (REST, not MCP) | n/a | Sends `X-Tavily-Access-Mode: keyless`. |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp` | MCP | Unclear. It only sends a header when there's a key. |

Exa returns text, not JSON, so OpenCode parses it with regexes: blocks split on `---`, with `URL:`, `Title:`,
`Published:`, and `Highlights:` lines. Parallel returns `structuredContent` (url, title, publish_date, excerpts),
which is cleaner.

## Behavior

- Input `{ query }`; output is titles, URLs, and excerpts, one markdown block per result.
- Works with every model, because the tool runs in MyPi, not at the provider.
- Keyless by default. A key, when set, only raises a backend's limits.
- Results are cited: each one carries its URL, so the agent can link its sources.
- Allowed in Plan mode: it's read-only.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tool | `webSearchTool(session)` in `src/tool/web-search.ts`, registered by `registerTools`; a folder once the backends land (see [Where the code goes](README.md#where-the-code-goes)) | TypeBox `parameters`. `annotations: { readOnlyHint: true, openWorldHint: true }`, so plan-build's rule allows it without asking. `promptSnippet` adds a line to pi's tool list in the system prompt. |
| Backend | `interface SearchBackend { id; name; search(query, signal) → Result[] }`, `Result` shaped like OpenCode's | One file per backend. |
| MCP call | A small `mcpCall(url, tool, args, headers, signal)` helper, like OpenCode's `mcp.ts` | JSON-RPC `tools/call` over one POST. Parse plain JSON or the first `data:` line. Cap and time out. No MCP client, no `registerMcpServer`. Moves to `src/core/util/` if web_fetch's fallback needs it too. |
| Backends | Parallel first, Exa as fallback | Both keyless. TinyFish and Tavily are keyless extras. A self-hosted SearXNG is the unmetered option. |
| Fallback | On HTTP 429, try the next backend | A plain ordered list. Skip OpenCode's random pick and cooldown map until rate limits actually hurt. |
| Keys | Optional `apiKey` per backend, resolved like `models.json`: `$ENV`, `${ENV}`, or `!command` | Never logged and never in tracked files. |
| Rendering | `renderCall` / `renderResult` | A short call line (`search "query"`) and a collapsed result list, like the built-in tools. |
| Exposure | `exposure: "direct"` to start | `"deferred"` keeps the tool out of every request until `tool_search` loads it, which saves tokens if search is rare. |

## Safety

- Excerpts are untrusted input. A page can contain instructions aimed at the model. Wrap results in clear
  delimiters, and say in the tool description that result text is data, not instructions.
- A query goes to a third-party service. That's fine for public questions, but the description should say not to
  put secrets or private code in a query.

## Slices

1. `mcpCall` helper and the Parallel backend, with tests against recorded responses.
2. The `web_search` tool: markdown result blocks, short error messages, annotations.
3. Exa as a second backend, and fallback to the next backend on HTTP 429.
4. Rendering (`renderCall` / `renderResult`).
5. Optional keys per backend.

## Open questions

- MCP: MCP-dependent work is deferred until MyPi has a shared MCP endpoint (see [Deferred](README.md#deferred)).
  Parallel and Exa are hosted MCP servers, but `mcpCall` is one plain HTTP POST, not MCP support. Build it now as
  designed, or wait and run web_search through the shared endpoint later?
- Backend order: Parallel then Exa, or SearXNG on the cluster first?
- First-use consent like OpenCode's, or just on?
- Can the user turn a built-in tool off (a `/tools` toggle like `/modules`), or is it always on?

## References

- pi: `docs/mcp.md`, `docs/extensions.md`, `examples/extensions/tools.ts`, and `ToolDefinition` in
  `dist/core/extensions/types.d.ts`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/websearch.ts`, `packages/core/src/websearch.ts`,
  `packages/core/src/plugin/websearch/*.ts`, and the docs page `services/www/src/docs/content/websearch.mdx`
- Parallel: [free search MCP](https://parallel.ai/blog/free-web-search-mcp), tools `web_search` and `web_fetch`
- Exa MCP: `https://mcp.exa.ai/mcp`, tools `web_search_exa` and `web_fetch_exa`
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) (WebSearch)
- Pi packages: [pi-agent-web-access](https://pi.dev/packages/pi-agent-web-access) (`web_search`, `fetch_content`),
  and a comparison of pi web search packages at deepakness.com/raw/pi-web-search-extensions
