import { keyText } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
import { isRecord } from "#core/util/guards";

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
