import type { Lookup } from "../manager";
import { kindName, type NamedSymbol } from "../symbols";

/** Most characters an answer holds; past it, whole symbols are left out with a note on how to narrow the call. */
export const MAX_ANSWER_CHARS = 20_000;

/** `1 symbol`, `3 symbols`: every count says what it counts. */
export function counted(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** A symbol's lines, 1-based: `41-53`, or `8` for one line. */
export function lineSpan({ start, end }: NamedSymbol): string {
  return start === end ? `${start + 1}` : `${start + 1}-${end + 1}`;
}

/** One symbol as a line: its kind and name path, then where it is, such as `method ServerManager/touch  41-53`. */
export function symbolLine(symbol: NamedSymbol, where: string): string {
  return `${kindName(symbol.kind)} ${symbol.path.join("/")}  ${where}`;
}

/**
 * `header` and as many `blocks` as fit in `MAX_ANSWER_CHARS`, one per line. When some don't fit, says how many of
 * how many blocks (each one `noun`) were left out, then `narrow`: how to ask for less.
 */
export function capAnswer(header: string, blocks: readonly string[], noun: string, narrow: string): string {
  let text = header;
  let shown = 0;
  for (const block of blocks) {
    if (text.length + block.length + 1 > MAX_ANSWER_CHARS) break;
    text += `\n${block}`;
    shown++;
  }

  if (shown === blocks.length) return text;
  const left = blocks.length - shown;
  return `${text}\n\nCut at ${MAX_ANSWER_CHARS} characters: ${left} of ${counted(blocks.length, noun)} not shown. ${narrow}`;
}

/**
 * Why a server can't answer, written for the agent: what to tell the user. "Don't install it yourself" stops a model
 * from running a global install nobody asked for.
 */
export function unavailable(lookup: Exclude<Lookup, { kind: "ready" }>): string {
  switch (lookup.kind) {
    case "no_server":
      return `No language server for ${lookup.extension} files. Read the file instead.`;
    case "missing": {
      const { language, command, install } = lookup.spec;
      return (
        `${language} language server isn't installed (${command} not found on PATH). Tell the user to install it ` +
        `with: ${install}, then try again. Don't install it yourself.`
      );
    }
    case "off":
      return `${lookup.spec.language} is turned off in /lsp. Ask the user to turn it on there.`;
    case "failed":
      return (
        `${lookup.spec.language} language server failed to start in ${lookup.root}: ${lookup.error}\n` +
        "Tell the user to fix it, then press Save in /lsp to retry."
      );
    case "stopped":
      return `${lookup.spec.language} language server stopped with the session.`;
  }
}
