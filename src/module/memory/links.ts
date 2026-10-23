import type { Memory, MemoryScope } from "./types";

/** `[[name]]`, where a name has no whitespace or `]`, so bash's `[[ -f x ]]` isn't a link. */
const LINK = /\[\[([^\s\]]+)\]\]/g;

/** The `[[name]]` links in a memory's text, each once, in the order they first appear. */
export function linksIn(text: string): string[] {
  const names = Array.from(text.matchAll(LINK), ([, name]) => name).filter((name) => name !== undefined);
  return [...new Set(names)];
}

/** Every memory name across the scopes, so a link resolves in either; a scope that can't be read adds none. */
export function memoryNames(...scopes: readonly MemoryScope[]): Set<string> {
  return new Set(scopes.flatMap((scope) => (scope.memories ?? []).map((memory) => memory.name)));
}

/** The memory's links to names that aren't in `names`. */
export function brokenLinks(memory: Memory, names: ReadonlySet<string>): string[] {
  return memory.links.filter((link) => !names.has(link));
}

/** Links as the agent writes them: `[[a]], [[b]]`. */
export function linkList(links: readonly string[]): string {
  return links.map((link) => `[[${link}]]`).join(", ");
}
