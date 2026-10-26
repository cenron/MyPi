/**
 * `text` as part of a file or branch name: lowercase, runs of anything but a–z and 0–9 become one `-`, at most `max`
 * characters, no dash at either end (the trim runs after the cut, which can land on a dash). `fallback` when nothing
 * is left, such as for text in another script. Plans and writer worktrees both name things this way.
 */
export function slugify(text: string, max: number, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}
