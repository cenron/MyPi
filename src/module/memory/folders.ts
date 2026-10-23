import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { isNodeError } from "#core/util/errors";
import { isNonEmptyString } from "#core/util/guards";
import type { Memory } from "./types";

const MEMORY_EXTENSION = ".md";
const MEMORY_FOLDER = "memories";
/** Listed in place of a description, so the agent sees the error and fixes the file. */
const INVALID_FRONTMATTER = "(frontmatter isn't valid YAML; fix it)";

/** Project memories, relative to the session's cwd. */
export const PROJECT_MEMORY_DIR = join(".pi", MEMORY_FOLDER);

/** Global memories: `<agent-dir>/memories`, so they follow `PI_CODING_AGENT_DIR` like the rest of pi's user files. */
export function globalMemoryDir(): string {
  return join(getAgentDir(), MEMORY_FOLDER);
}

/**
 * Every memory under `dir`, sorted by name, or `[]` when `dir` doesn't exist. Sync, because `init()` isn't awaited
 * and the list has to be in the prompt before the first run. Other read errors throw.
 */
export function readMemories(dir: string): Memory[] {
  return memoryFiles(dir).map((path) => ({
    name: relative(dir, path).slice(0, -MEMORY_EXTENSION.length),
    description: descriptionOf(readFileSync(path, "utf8")),
  }));
}

/**
 * The `description:` from the memory's frontmatter, through pi's own parser; undefined when there's none or it isn't a
 * string. Pi's parser throws on invalid YAML (an unquoted `: ` is enough), which is flagged instead of dropped.
 */
function descriptionOf(text: string): string | undefined {
  try {
    const { description } = parseFrontmatter(text).frontmatter;
    return isNonEmptyString(description) ? description : undefined;
  } catch {
    return INVALID_FRONTMATTER;
  }
}

/** The `.md` files under `dir`, at any depth, sorted by path. */
function memoryFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(MEMORY_EXTENSION))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}
