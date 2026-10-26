import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { errorMessage, isNodeError } from "#core/util/errors";

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
};

/** pi's thinking levels, plus `inherit` (the parent's), the default. */
export const THINKING_LEVELS = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export type ThinkingSetting = (typeof THINKING_LEVELS)[number];

/** Parses one agent file and reports invalid values with the source path. */
export function parseAgentFile(file: string, source: string): AgentDefinition {
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
  const thinking = THINKING_LEVELS.find((level) => level === optionalString(frontmatter, "thinking", "inherit", file));
  if (!thinking) throw new Error(`${file}: invalid field 'thinking'`);
  const tools = frontmatter.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.some((tool) => typeof tool !== "string"))) {
    throw new Error(`${file}: invalid field 'tools'`);
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
  const folders = [builtinDir, join(getAgentDir(), "agents"), ...(trusted ? [join(cwd, ".pi", "agents")] : [])];
  const agents = new Map<string, AgentDefinition>();
  for (const folder of folders) {
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
        agents.set(definition.name, definition);
      } catch (error) {
        warn(errorMessage(error));
      }
    }
  }
  return [...agents.values()];
}

function optionalString(frontmatter: Record<string, unknown>, field: string, fallback: string, file: string) {
  const value = frontmatter[field];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${file}: invalid field '${field}'`);
  return value;
}
