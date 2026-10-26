import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { errorMessage, isNodeError } from "#core/util/errors";
import { THINKING_LEVELS } from "#core/util/thinking";
import { validateName } from "#core/worktree/git";

/** Access allowed to an agent's child session. */
export type AgentAccess = "read-only" | "write";

/** Parsed agent instructions and their execution defaults. */
export type AgentDefinition = {
  name: string;
  description: string;
  access: AgentAccess;
  tools?: string[];
  model: string;
  thinking: ThinkingSetting;
  prompt: string;
  source: "builtin" | "user" | "project";
  path: string;
};

/** pi's thinking levels, plus `inherit` (the parent's), the default. */
export const THINKING_SETTINGS = ["inherit", ...THINKING_LEVELS] as const;

export type ThinkingSetting = (typeof THINKING_SETTINGS)[number];

/** User agent definitions live beside pi's other user configuration. */
export function userAgentDir(): string {
  return join(getAgentDir(), "agents");
}

/** Project agent definitions live in the project-local pi folder. */
export function projectAgentDir(cwd: string): string {
  return join(cwd, ".pi", "agents");
}

/**
 * The tools a child can have: pi's built-ins (its `allToolNames`, which the package doesn't export). A child loads no
 * extensions, so MyPi's tools (`lsp`, `web_search`, …) don't exist there; naming one was silently ignored.
 */
const CHILD_TOOLS = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);

/** Parses one agent file and reports invalid values with the source path. */
export function parseAgentFile(file: string, source: string): Omit<AgentDefinition, "source" | "path"> {
  let frontmatter: Record<string, unknown>;
  let prompt: string;
  try {
    ({ frontmatter, body: prompt } = parseFrontmatter(source));
  } catch (error) {
    throw new Error(`${file}: invalid frontmatter: ${errorMessage(error)}`);
  }

  const required = (field: string) => {
    const value = frontmatter[field];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${file}: missing or invalid field '${field}'`);
    return value;
  };
  const name = required("name");
  const description = required("description");
  const access = required("access");
  if (access !== "read-only" && access !== "write") throw new Error(`${file}: invalid field 'access'`);

  const model = optionalString(frontmatter, "model", "inherit", file);
  const thinking = THINKING_SETTINGS.find(
    (level) => level === optionalString(frontmatter, "thinking", "inherit", file),
  );
  if (!thinking) throw new Error(`${file}: invalid field 'thinking'`);
  const tools = frontmatter.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string"))) {
    throw new Error(`${file}: invalid field 'tools'`);
  }
  const unknown = (tools ?? []).filter((tool: string) => !CHILD_TOOLS.has(tool));
  if (unknown.length) {
    throw new Error(
      `${file}: a subagent can't use ${unknown.join(", ")}: it has pi's built-in tools only (${[...CHILD_TOOLS].join(", ")})`,
    );
  }

  return {
    name,
    description,
    access,
    ...(tools === undefined ? {} : { tools: tools as string[] }),
    model,
    thinking,
    prompt: prompt.trim(),
  };
}

/** Loads builtins, then user and trusted-project definitions; later definitions override earlier names. */
export function loadAgents(builtinDir: string, cwd: string, trusted: boolean, warn: (message: string) => void) {
  const folders = [
    { path: builtinDir, source: "builtin" as const },
    { path: userAgentDir(), source: "user" as const },
    ...(trusted ? [{ path: projectAgentDir(cwd), source: "project" as const }] : []),
  ];
  const agents = new Map<string, AgentDefinition>();
  for (const { path: folder, source } of folders) {
    let files: string[];
    try {
      files = readdirSync(folder).filter((file) => file.endsWith(".md"));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") continue;
      warn(`Could not read subagent folder ${folder}: ${errorMessage(error)}`);
      continue;
    }
    for (const file of files) {
      const path = join(folder, file);
      try {
        const definition = parseAgentFile(path, readFileSync(path, "utf8"));
        agents.set(definition.name, { ...definition, source, path });
      } catch (error) {
        warn(errorMessage(error));
      }
    }
  }
  return [...agents.values()];
}

/** Throws what `parseAgentFile` would say about `agent` once saved, so a change can be refused before it's approved. */
export function checkAgent(agent: Omit<AgentDefinition, "source" | "path">): string {
  validateAgentName(agent.name);
  const text = serializeAgent(agent);
  parseAgentFile(`${agent.name}.md`, text);
  return text;
}

/** Saves one validated definition into the selected user or project agent folder. */
export function saveAgent(agent: Omit<AgentDefinition, "source" | "path">, folder: string): string {
  const text = checkAgent(agent);
  const path = join(folder, `${agent.name}.md`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path, text);
  return path;
}

/** Removes a user or project agent file; builtins are never removable. */
export function deleteAgent(agent: AgentDefinition): void {
  if (agent.source === "builtin") throw new Error(`Built-in agent '${agent.name}' can't be deleted.`);
  rmSync(agent.path);
}

/** Agent names double as safe file names and worktree names. */
export function validateAgentName(name: string): void {
  try {
    validateName(name);
  } catch {
    throw new Error("Agent name must be 1–64 lowercase letters, digits, or hyphens, starting with a letter or digit.");
  }
}

/** Keeps agent files and editor prefills in the same parseable frontmatter format. */
export function serializeAgent(agent: Omit<AgentDefinition, "source" | "path">): string {
  const fields = [
    `name: ${JSON.stringify(agent.name)}`,
    `description: ${JSON.stringify(agent.description)}`,
    `access: ${agent.access}`,
    ...(agent.tools === undefined ? [] : [`tools: ${JSON.stringify(agent.tools)}`]),
    `model: ${JSON.stringify(agent.model)}`,
    `thinking: ${agent.thinking}`,
  ];
  return `---\n${fields.join("\n")}\n---\n\n${agent.prompt.trim()}\n`;
}

function optionalString(frontmatter: Record<string, unknown>, field: string, fallback: string, file: string) {
  const value = frontmatter[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${file}: invalid field '${field}'`);
  return value;
}
