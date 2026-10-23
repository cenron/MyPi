/**
 * True for a plain object: not `null`, not an array. Use it before reading fields off JSON or other unknown values.
 *
 * @example
 * const reply: unknown = JSON.parse(text);
 * if (isRecord(reply) && Array.isArray(reply.results)) {
 *   // reply.results is unknown[] here
 * }
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a string with at least one character. Use it to keep an optional field only when it has a value.
 *
 * @example
 * if (isNonEmptyString(entry.title)) result.title = entry.title;
 * const excerpts = entry.excerpts.filter(isNonEmptyString); // drops "", null, and non-strings
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}
