import { type AgentToolResult, formatSize, type Theme } from "@earendil-works/pi-coding-agent";
import { expandKey, textOf } from "#ui/render";
import { mimeOf } from "./http";
import type { FetchedDetails, Format } from "./types";

/** The call's arguments as the renderer sees them: any may be missing while the model is still writing the call. */
export type CallArgs = { url?: string; format?: Format; timeout?: number };

/** The call line: `web_fetch <url>`, with `(html)` when the page source was asked for. */
export function formatCall(args: CallArgs, theme: Theme): string {
  const format = args.format === "html" ? theme.fg("dim", " (html)") : "";
  return `${theme.fg("toolTitle", theme.bold("web_fetch"))} ${theme.fg("accent", args.url ?? "")}${format}`;
}

/**
 * The result below the call line. Collapsed, one summary line: the page's title (or URL), how much text came back
 * and from what, where a redirect landed, and the saved file when the text was cut. Expanded, the summary and then
 * the text the model got. An error shows its message either way.
 */
export function formatResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  isError: boolean,
  theme: Theme,
): string {
  const text = textOf(result.content);
  if (isError) return `\n${theme.fg("error", text)}`;
  // pi types `details` as unknown here, and a failed call has none.
  const details = result.details as FetchedDetails | undefined;
  if (!details) return "";

  const lines = [summary(details, text, theme)];
  if (details.finalUrl !== details.url) lines.push(theme.fg("muted", `→ ${details.finalUrl}`));
  if (details.fullTextPath) lines.push(theme.fg("warning", `Cut to fit; full text in ${details.fullTextPath}`));

  if (!expanded) {
    return `\n${lines.join("\n")} ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
  }
  const body = text.split("\n").map((line) => theme.fg("toolOutput", line));
  return `\n${[...lines, "", ...body].join("\n")}`;
}

/** `Title · 5.8KB of markdown from 156KB of HTML`, or `URL · 2.1KB of application/json` when nothing was converted. */
function summary(details: FetchedDetails, text: string, theme: Theme): string {
  const name = theme.bold(details.title ?? details.finalUrl);
  const sent = formatSize(Buffer.byteLength(text));
  const type = mimeOf(details.contentType) || "an untyped response";
  const what = details.converted
    ? `${sent} of markdown from ${formatSize(details.bytes)} of HTML`
    : `${sent} of ${type}${details.truncated ? `, cut from ${formatSize(details.bytes)}` : ""}`;
  return `${name} ${theme.fg("muted", `· ${what}`)}`;
}
