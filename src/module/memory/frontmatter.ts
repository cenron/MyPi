const FENCE = "---";
const DESCRIPTION_KEY = "description:";

/**
 * The `description:` value from the `---` block at the top of a memory, or undefined when there's none. Reads that one
 * line only, so YAML beyond a plain or quoted value isn't supported; such a memory is listed by its name alone.
 */
export function parseDescription(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== FENCE) return undefined;
  const end = lines.indexOf(FENCE, 1);
  if (end === -1) return undefined;

  const line = lines.slice(1, end).find((l) => l.startsWith(DESCRIPTION_KEY));
  if (line === undefined) return undefined;
  return unquote(line.slice(DESCRIPTION_KEY.length).trim()) || undefined;
}

/** `value` without one pair of matching surrounding quotes, `"…"` or `'…'`. */
function unquote(value: string): string {
  const quote = value[0];
  const isQuoted = value.length >= 2 && (quote === '"' || quote === "'") && value.at(-1) === quote;
  return isQuoted ? value.slice(1, -1) : value;
}
