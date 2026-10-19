# Web search

**Status:** idea

## Goal

Let the agent search the web and read pages, with any model, including local ones. Pi 1.2.0 has no web search
built in.

## What pi offers

Checked against the installed pi 1.2.0:

| Route | How | Verdict |
|---|---|---|
| An MCP server | `pi mcp add exa --url https://mcp.exa.ai/mcp`, or `pi.registerMcpServer(name, config)` from code | Works today with no code. Exa's hosted server needs no key for light use. Tools arrive as `mcp__<server>__<tool>`. |
| MyPi's own tools | `pi.registerTool({ name: "web_search", … })` calling a search API | Full control over the backend, output size, rendering, and annotations. |
| Provider-native search | Anthropic's `web_search` server tool or OpenAI's `web_search`, added through `before_provider_request` | Not possible: pi-ai 1.2.0 doesn't handle `server_tool_use` or `web_search_tool_result` blocks in replies (no match in `pi-ai/dist`). It would also only work for those two providers. |
| A pi package | `pi install npm:pi-agent-web-access` and similar | Works, but lives outside MyPi. Useful to read for ideas. |

## Behavior

- Two tools: `web_search` (query → titles, URLs, snippets) and `web_fetch` (URL → readable markdown, capped).
- Works with every model, because the tools run in MyPi, not at the provider.
- Results are cited: each one carries its URL, so the agent can link its sources.
- Allowed in Plan mode: both tools are read-only.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tools | `pi.registerTool()` from the module's `init()` | TypeBox `parameters`. Set `annotations: { readOnlyHint: true, openWorldHint: true }` so permission code, plan-build's guard included, can tell they're safe. `promptSnippet` adds a line to pi's tool list in the system prompt. |
| Backend | One small interface, `search(query, signal) → Result[]` | Start with one backend. Candidates: Exa (has a free hosted MCP and an API), Brave (about 1,000 free queries a month from its $5 monthly credit, then paid), Tavily, or a self-hosted SearXNG (free and keyless, needs a server). |
| Keys | `apiKey` strings resolved like `models.json`: `$ENV`, `${ENV}`, or `!command` | Never logged and never in tracked files. |
| Fetch | `fetch` with the tool's `signal`, HTML to markdown, a size cap | See `examples/extensions/truncated-tool.ts` for pi's pattern for cutting long output and telling the model it was cut. |
| Rendering | `renderCall` / `renderResult` | A short call line (`search "query"`) and a collapsed result list, like the built-in tools. |
| Exposure | `exposure: "direct"` to start | `"deferred"` keeps the tools out of every request until `tool_search` loads them, which saves tokens if search is rare. |
| MCP alternative | `pi.registerMcpServer("exa", { url })` in `init()` | It connects right away when registered after load. A same-name server in `mcp.json` wins, so a user override still works. |

## Safety

- Fetched pages are untrusted input. A page can contain instructions aimed at the model. Wrap results in clear
  delimiters, and say in the tool description that page text is data, not instructions.
- Only `http` and `https` URLs. Decide whether to block private and loopback addresses, so a page can't point the agent
  at a local service.

## Slices

1. `web_search` against one backend, with plain text output.
2. `web_fetch` with HTML to markdown and a size cap.
3. Rendering, and the annotations plan-build's guard reads.
4. A second backend behind the same interface, or the MCP route as a fallback.

## Open questions

- Which backend first, and is a paid key acceptable?
- Own tools, or just register Exa's MCP server and stop there?
- Block private network addresses in `web_fetch`?
- Load type: `ON_LOAD` (on by default) or `ON_DEMAND`?

## References

- pi: `docs/mcp.md`, `docs/extensions.md`, `examples/extensions/truncated-tool.ts`, `examples/extensions/tools.ts`,
  and `ToolDefinition` in `dist/core/extensions/types.d.ts`
- Exa MCP: `https://mcp.exa.ai/mcp`, tools `web_search_exa` and `web_fetch_exa`
- Pi packages: [pi-agent-web-access](https://pi.dev/packages/pi-agent-web-access) (`web_search`, `fetch_content`),
  and a comparison of pi web search packages at deepakness.com/raw/pi-web-search-extensions
