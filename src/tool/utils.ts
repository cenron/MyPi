import { type ExtensionToolContext, keyText } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import type { JobInfo } from "#core/types";
import { isRecord } from "#core/util/guards";

/**
 * Calls an MCP tool through `ctx.executeTool` and returns the MCP result pi keeps whole in `structuredContent`
 * (`{ content, structuredContent? }`), not the model's copy, which pi cuts at 20 KB. Throws an error outcome's text.
 *
 * The call goes through pi's tool pipeline (the tool guard, plan-build's rule) and is cancelled with the calling tool.
 * Declare the MCP tool in the calling tool's `reachesTools`, so pi waits for its server to connect first.
 *
 * @example
 * // In a tool's execute(_id, params, signal, onUpdate, ctx):
 * const call = await callMcpTool(ctx, "mcp__parallel__web_search", { objective: query, search_queries: [query] });
 * const reply = call.structuredContent; // the server's own structured reply, if it sends one
 * const text = textOf(call.content); // or its text reply, whole
 */
export async function callMcpTool(
  ctx: ExtensionToolContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outcome = await ctx.executeTool(tool, args);
  if (outcome.isError) throw new Error(textOf(outcome.result.content));

  const call = outcome.result.structuredContent;
  if (!isRecord(call)) throw new Error(`${tool} returned no MCP result.`);
  return call;
}

/**
 * The text parts of MCP or pi content, joined with a newline. Anything that isn't a text part is skipped, and
 * anything that isn't a list gives "".
 *
 * @example
 * textOf(result.content); // a tool result's text, such as its error message in a renderer
 * textOf([{ type: "text", text: "one" }, { type: "image", data: "…" }, { type: "text", text: "two" }]); // "one\ntwo"
 */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const texts = content.flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []));
  return texts.join("\n");
}

/**
 * The key that expands a tool's result, for a renderer's `(… to expand)` hint. `keyText` is empty outside the TUI,
 * where no keybindings are loaded, so it falls back to pi's default.
 *
 * @example
 * if (!expanded) return `${summary} ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
 */
export function expandKey(): string {
  return keyText("app.tools.expand") || "ctrl+o";
}

/**
 * A renderer's `Text` with `content` set: the one pi passed back as `lastComponent`, or a new one the first time. One
 * `Text` per slot, reused across redraws, as pi's own tools do.
 *
 * @example
 * renderCall(args, theme, context) {
 *   return reuseText(context.lastComponent, formatCall(args, theme));
 * },
 */
export function reuseText(lastComponent: Component | undefined, content: string): Text {
  const text = (lastComponent as Text | undefined) ?? new Text("", 0, 0);
  text.setText(content);
  return text;
}

/**
 * The site a URL is on, for a short label: its hostname without `www.`. Undefined when the URL doesn't parse.
 *
 * @example
 * siteOf("https://www.example.com/docs/page"); // "example.com"
 * siteOf("not a url"); // undefined
 */
export function siteOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * How a job ended, or `running`: `completed (exit code 0)`, `failed (exit code 3)`, `failed` (it threw), or `stopped`.
 *
 * @example
 * `Background job ${job.id} ${jobEnding(job)} after ${jobDuration(job)}: ${job.label}`
 * // "Background job 1 completed (exit code 0) after 3.0s: npm test"
 */
export function jobEnding({ status, exitCode }: JobInfo): string {
  return exitCode === undefined ? status : `${status} (exit code ${exitCode})`;
}

/**
 * How long a job ran, or has run so far while it's running, in seconds with one decimal, such as `3.0s`.
 *
 * @example
 * `${job.id} · ${jobEnding(job)} · ${jobDuration(job)}` // "2 · running · 12.4s"
 */
export function jobDuration({ startedAt, endedAt }: JobInfo): string {
  return `${(((endedAt ?? Date.now()) - startedAt) / 1000).toFixed(1)}s`;
}
