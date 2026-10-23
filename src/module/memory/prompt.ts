import { brokenLinks, linkList, memoryNames } from "./links";
import type { Memory, MemoryScope } from "./types";

/** How the agent keeps its memories; the lists follow it. */
const CONVENTIONS = `You have persistent memory: Markdown that lasts across sessions. These lists show names and descriptions, not contents; use read for relevant memories. A memory can be out of date: check it against the code before relying on it, and fix or delete it if it's wrong.
- Save only what a future session needs and can't get from the code, git history, or AGENTS.md, not details of the current task: user preferences and corrections globally, project facts (build, tests, conventions, known gotchas) in project memories.
- When the user corrects you or states a preference, or you work around a problem a future session would hit again (a missing tool, a failing command, a surprising config), save it before you finish.
- Store one fact per <folder>/<topic>/<name>.md, where <folder> is the scope's folder listed below; <topic> is optional, and existing topics should be reused. Start each file with three lines: ---, description: <short description>, ---. Quote the description if it contains a colon.
- For corrections or preferences, include why and how to apply them.
- Update existing memories instead of duplicating them. Link related memories with [[name]], using the name as listed; fix any link the list flags as broken.
- Never save secrets. If a memory can't be written, treat it as read-only and leave it unchanged.
- Saving memories is allowed in plan mode.`;

/** What `/onboard` sends: learn the project, then save it as memories under the conventions above. */
export const ONBOARD_PROMPT = `Onboard to this project and save what a future session needs as project memories, following the memory conventions in your instructions.
- First read the project memories already listed, and AGENTS.md or CLAUDE.md if present. Update or extend those; don't repeat them.
- Skip dependency, vendored, and generated folders, whatever the language: installed packages and build output such as node_modules, vendor, .venv or venv, __pycache__, target (Rust, Maven), build and dist, .gradle, Pods, .next, and bin and obj (.NET). List files with git ls-files or rg --files, which leave out what .gitignore ignores.
- Learn: what the project is and how it's laid out; how to install, build, test, lint, and run it, from package files, CI config, and docs (read the commands; don't run builds or tests); the code conventions you see; and anything surprising a newcomer would trip on.
- Write one fact per memory, under topics such as overview, build, test, conventions, and gotchas. Keep each to what can't be read faster from the code.
- End with a short list of the memories you wrote or changed.`;

/** Memory's prompt section: the conventions, then each scope's folder and memories. */
export function memoryPrompt(project: MemoryScope, global: MemoryScope): string {
  const names = memoryNames(project, global);
  return [CONVENTIONS, scopeList("Project memories", project, names), scopeList("Global memories", global, names)].join(
    "\n\n",
  );
}

function scopeList(title: string, scope: MemoryScope, names: ReadonlySet<string>): string {
  return [`${title} (${scope.dir}):`, ...memoryLines(scope.memories, names)].join("\n");
}

function memoryLines(memories: readonly Memory[] | undefined, names: ReadonlySet<string>): string[] {
  if (memories === undefined) return ["(this folder can't be read)"];
  if (memories.length === 0) return ["(none yet)"];
  return memories.map((memory) => memoryLine(memory, names));
}

/** `- name — description`, flagging links to memories that don't exist so the agent fixes them. */
function memoryLine(memory: Memory, names: ReadonlySet<string>): string {
  const description = memory.description === undefined ? "" : ` — ${memory.description}`;

  const broken = brokenLinks(memory, names);
  const flag = broken.length === 0 ? "" : ` (broken links: ${linkList(broken)})`;
  return `- ${memory.name}${description}${flag}`;
}
