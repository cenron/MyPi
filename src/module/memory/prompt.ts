import type { Memory, MemoryScope } from "./types";

/** How the agent keeps its memories; the lists follow it. */
const CONVENTIONS = `You have persistent memory: Markdown that lasts across sessions. These lists show names and descriptions, not contents; use read for relevant memories. A memory can be out of date: check it against the code before relying on it, and fix or delete it if it's wrong.
- Save only what a future session needs and can't get from the code, git history, or AGENTS.md, not details of the current task: user preferences and corrections globally, project facts (build, tests, conventions, known gotchas) in project memories.
- Store one fact per <folder>/<topic>/<name>.md, where <folder> is the scope's folder listed below; <topic> is optional, and existing topics should be reused. Start each file with three lines: ---, description: <short description>, ---.
- For corrections or preferences, include why and how to apply them.
- Update existing memories instead of duplicating them. Link related memories with [[name]], using the name as listed.
- Never save secrets. If a memory can't be written, treat it as read-only and leave it unchanged.`;

/** Memory's prompt section: the conventions, then each scope's folder and memories. */
export function memoryPrompt(project: MemoryScope, global: MemoryScope): string {
  return [CONVENTIONS, scopeList("Project memories", project), scopeList("Global memories", global)].join("\n\n");
}

function scopeList(title: string, scope: MemoryScope): string {
  return [`${title} (${scope.dir}):`, ...memoryLines(scope.memories)].join("\n");
}

function memoryLines(memories: readonly Memory[] | undefined): string[] {
  if (memories === undefined) return ["(this folder can't be read)"];
  if (memories.length === 0) return ["(none yet)"];
  return memories.map(({ name, description }) =>
    description === undefined ? `- ${name}` : `- ${name} — ${description}`,
  );
}
