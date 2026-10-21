# web_fetch

**Status:** building (registered as a stub that returns `TODO`; slice 1 next)

## Goal

Let the agent read a web page as markdown, with any model. Pi 1.2.0 has no fetch tool, and `bash` with `curl`
returns raw HTML that wastes context. Finding pages is the job of [web_search](web-search.md).

## Other harnesses

| Harness | web_fetch |
|---|---|
| Claude Code | Local fetch, then a small model answers a `prompt` over the page |
| Codex CLI | None |
| OpenCode | Plain HTTP GET plus its own HTML-to-markdown |

OpenCode is the model to copy. Read from its `dev` branch (`anomalyco/opencode`, 2026-10-20).

### OpenCode's web_fetch

There's no backend; it's a direct GET (`packages/core/src/tool/plugin/webfetch.ts`).

- **Input:** `{ url, format: "markdown" | "text" | "html" (default markdown), timeout? }`. The timeout defaults to
  30 seconds, and the maximum is 120.
- **Checks:** only `http:` and `https:` URLs. Permission is checked with the URL as the resource.
- **Request:**
  - It sends a browser-like `User-Agent`.
  - `Accept` is weighted by the requested format, so a server that can return markdown does.
  - On a Cloudflare challenge (403 with `cf-mitigated: challenge`), it retries once with the User-Agent `opencode`.
- **Content types:** text, JSON, XML, and JS are accepted. Images and binary files are rejected, so PDFs don't work.
- **Size:** the body is read as a stream with a 5 MB cap, and a `Content-Length` over the cap is rejected up front.
- **Conversion:** only when the content type is HTML.
  - Its own converter, about 650 lines on `htmlparser2` (`packages/core/src/tool/html-markdown.ts`), not Turndown.
  - It drops `script`, `style`, `iframe`, `template`, and similar tags.
  - It keeps links, lists, tables, code blocks, and quotes.
  - `text` mode strips the tags. Markdown or JSON pages pass through unchanged.
- **Long output:** the tool framework shows the model a preview and keeps the full text.
- **Not handled:** no small model summarizing the page, no cache, and no block on private or loopback addresses.

## Behavior

- Input `{ url }`, maybe `format` and `timeout` like OpenCode's; output is readable markdown, capped.
- Works with every model and needs no service: a plain GET from the machine pi runs on.
- Allowed in Plan mode: it's read-only.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tool | `webFetchTool(session)` in `src/tool/web-fetch.ts`, registered by `registerTools` (see [Where the code goes](README.md#where-the-code-goes)) | TypeBox `parameters`. `annotations: { readOnlyHint: true, openWorldHint: true }`, so plan-build's rule allows it without asking. |
| Request | `fetch` with the tool's `signal`, a timeout, and an `Accept` header weighted by format | Stream the body and stop at the cap. Reject a `Content-Length` over the cap before reading. |
| Conversion | HTML to markdown | Port OpenCode's converter, use Turndown, or add a readability step first (open question). |
| Long output | pi's truncation pattern | See `examples/extensions/truncated-tool.ts` for cutting long output and telling the model it was cut. |
| Rendering | `renderCall` / `renderResult` | A short call line (`fetch <url>`) and a collapsed body. |

## Safety

- Fetched pages are untrusted input. A page can contain instructions aimed at the model. Wrap the body in clear
  delimiters, and say in the tool description that page text is data, not instructions.
- Only `http` and `https` URLs.
- Block private and loopback addresses, so a page can't point the agent at a local service. OpenCode doesn't. Check
  the resolved IP, not just the hostname, and recheck after redirects.

## Slices

1. GET with content-type checks, the size cap, and the timeout; plain text out.
2. HTML to markdown.
3. The private-address block, including redirects.
4. Long-output truncation and rendering.

## Open questions

- HTML to markdown: port OpenCode's converter, use Turndown, or add a readability step that keeps only the main
  content?
- When a plain GET fails or returns nothing useful (JS-heavy page, PDF), fall back to Parallel's or Exa's fetch tool?
  That would share web_search's `mcpCall` helper.
- Add Claude Code's `prompt` parameter, so a cheap model answers a question over the page instead of returning all of
  it?
- Keep OpenCode's `format` parameter, or always return markdown?

## References

- pi: `docs/extensions.md`, `examples/extensions/truncated-tool.ts`, and `ToolDefinition` in
  `dist/core/extensions/types.d.ts`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/webfetch.ts`,
  `packages/core/src/tool/html-markdown.ts`, `packages/core/src/tool/http-body.ts`
- Parallel: [free search MCP](https://parallel.ai/blog/free-web-search-mcp), whose `web_fetch` handles PDFs and
  JS-heavy pages
- Claude Code: [tools reference](https://code.claude.com/docs/en/tools-reference) (WebFetch)
