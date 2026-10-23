import { join } from "node:path";
import type { Command } from "#core/types";
import { INVALID_FRONTMATTER } from "../folders";
import { brokenLinks, linkList, memoryNames } from "../links";
import type { Memory, MemoryScope } from "../types";

/** `/memory-check`: reads both folders now and reports what the list flags, for when I want to look myself. */
export function memoryCheckCmd(readScopes: () => readonly MemoryScope[]): Command {
  return {
    info: { name: "memory-check", description: "Check memories for broken [[links]] and invalid frontmatter" },
    execute: () => checkReport(readScopes()),
  };
}

/** `/memory-check`'s report: every problem the list flags, by file, or that there are none. */
export function checkReport(scopes: readonly MemoryScope[]): string {
  const names = memoryNames(...scopes);
  const problems = scopes.flatMap((scope) => scopeProblems(scope, names));

  if (problems.length === 0) return `Memory check: no problems in ${names.size} memories.`;
  const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return [`Memory check: ${count}.`, ...problems.map((problem) => `- ${problem}`)].join("\n");
}

function scopeProblems(scope: MemoryScope, names: ReadonlySet<string>): string[] {
  if (scope.memories === undefined) return [`${scope.dir}: the folder can't be read`];

  return scope.memories.flatMap((memory) =>
    memoryProblems(memory, names).map((problem) => `${join(scope.dir, memory.name)}.md: ${problem}`),
  );
}

function memoryProblems(memory: Memory, names: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (memory.description === INVALID_FRONTMATTER) problems.push("frontmatter isn't valid YAML");

  const broken = brokenLinks(memory, names);
  if (broken.length > 0) problems.push(`broken links: ${linkList(broken)}`);
  return problems;
}
