import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { siteOf } from "#tool/utils";
import { expandKey, textOf } from "#ui/render";
import type { SearchDetails, SearchResult } from "./types";

/** The call's arguments as the renderer sees them: the query may be missing while the model is still writing it. */
export type CallArgs = { query?: string };

/** The call line: `web_search "query"`. */
export function formatCall(args: CallArgs, theme: Theme): string {
  const title = theme.fg("toolTitle", theme.bold("web_search"));
  return args.query === undefined ? title : `${title} ${theme.fg("accent", `"${args.query}"`)}`;
}

/**
 * The result below the call line. Collapsed: `10 results from Parallel`, then one line per result, with its title
 * (or URL) and its site. Expanded: each result's title, URL, date, and excerpt. An error shows its message either
 * way.
 */
export function formatResult(
  result: AgentToolResult<unknown>,
  expanded: boolean,
  isError: boolean,
  theme: Theme,
): string {
  if (isError) return `\n${theme.fg("error", textOf(result.content))}`;
  // pi types `details` as unknown here, and a failed call has none.
  const details = result.details as SearchDetails | undefined;
  if (!details) return "";

  const { results, backend } = details;
  if (results.length === 0) return `\n${theme.fg("muted", `No results from ${backend.name}`)}`;

  const count = theme.bold(`${results.length} ${results.length === 1 ? "result" : "results"}`);
  const summary = `${count} ${theme.fg("muted", `from ${backend.name}`)}`;

  if (!expanded) {
    const lines = [summary, ...results.map((each) => listLine(each, theme))];
    return `\n${lines.join("\n")} ${theme.fg("dim", `(${expandKey()} to expand)`)}`;
  }
  const blocks = results.map((each) => block(each, theme));
  return `\n${[summary, ...blocks].join("\n\n")}`;
}

/** A result in the collapsed list: `Title · site`, or the URL when there's no title. */
function listLine({ url, title }: SearchResult, theme: Theme): string {
  const site = siteOf(url);
  return `${title ?? url}${site ? theme.fg("muted", ` · ${site}`) : ""}`;
}

/** A result in the expanded list: its title, URL, date, and excerpt, each when it has one. */
function block({ url, title, published, excerpt }: SearchResult, theme: Theme): string {
  const lines = title ? [theme.bold(title), theme.fg("accent", url)] : [theme.fg("accent", url)];
  if (published) lines.push(theme.fg("dim", `Published: ${published}`));
  if (excerpt) lines.push(...excerpt.split("\n").map((line) => theme.fg("toolOutput", line)));
  return lines.join("\n");
}
