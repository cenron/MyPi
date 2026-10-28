import { readdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { getDocsPath, getExamplesPath, getReadmePath } from "@earendil-works/pi-coding-agent";
import type { ToolCall, ToolEnv, Verdict } from "#core/tool-guard";
import { commandPaths, hasExistingRoot, isInside, resolveToolPath } from "#core/util/paths";
import { isReadOnlyCommand } from "#core/util/shell";
import { BaseRule, type RuleInfo } from "./base";

/** MCP tools are named `mcp__<server>__<tool>`; their `path` arguments mean whatever the server says, not a file. */
const MCP_PREFIX = "mcp__";

/** Device files a tool may name without reaching anyone's files. */
const DEVICE_FILES = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

/**
 * Shared scratch space agents reach for by habit, next to `os.tmpdir()` (`/var/folders/…/T` on macOS). macOS's `/tmp`
 * links to `/private/tmp`, and the guard compares text, so both are listed.
 */
const SCRATCH_DIRS = ["/tmp", "/private/tmp"];

/**
 * The temp folder, as `os.tmpdir()` names it and by its real path: on macOS `/var` links to `/private/var`, and a
 * session started in a temp folder runs from the real path, so `..` from it names `/private/var/folders/…/T`.
 */
const TEMP_DIRS = [tmpdir(), realpathSync(tmpdir())];

/** Root folders present when the guard loads; an absolute command path with another root cannot reach a file. */
const ROOT_DIRS = readdirSync("/");

/** pi's own docs, examples, and README: pi points the model there for questions about pi, so reading them is safe. */
const PI_DOCS = [getDocsPath(), getExamplesPath(), getReadmePath()];

/** Tools that only read: they may reach the modules' data folders (`readableDirs`). */
const READING_TOOLS = new Set(["read", "grep", "find", "ls", "lsp"]);

const ALLOW: Verdict = { kind: "allow" };

/** What "Allow for this session" will cover, at the end of each question. */
const TREE = "(and anything under it)";
const PATH_ONLY = "(this path only)";

/**
 * Asks before a call that reaches outside the session's folder: a `path` input, or the places a `bash` command names
 * (`commandPaths`). Allowed without asking: the modules' writable folders, their data folders for a call that only
 * reads, the temp folder (background jobs and web_fetch
 * write there) and `/tmp`, the `/dev` streams, and the skills and context files pi put in the prompt. Each question
 * names one place, not the call, so "Allow for this session" covers that path and its whole tree across tools; for the
 * home folder and the folders above it, only the path itself.
 */
export class FolderRule extends BaseRule {
  /** Places allowed for the session with everything under them. */
  private readonly allowedTrees = new Set<string>();
  /** Places allowed for the session on their own: home and above, where a tree would allow nearly everything. */
  private readonly allowedPaths = new Set<string>();

  get info(): RuleInfo {
    return {
      name: "folder-guard",
      description: "Asks before a tool call reaches outside the session's folder, in Plan and Build.",
    };
  }

  check({ toolName, input }: ToolCall, { cwd, home, writableDirs, readableDirs }: ToolEnv): Verdict {
    const allowed = [
      cwd,
      ...writableDirs,
      ...(onlyReads(toolName, input) ? [...readableDirs, ...PI_DOCS] : []),
      ...TEMP_DIRS,
      ...SCRATCH_DIRS,
      ...DEVICE_FILES,
      ...this.prompt.paths,
      ...this.allowedTrees,
    ];
    const outside = pathsOf(toolName, input, cwd, home).filter(
      (path) => !this.allowedPaths.has(path) && !allowed.some((dir) => isInside(dir, path)),
    );
    if (outside.length === 0) return ALLOW;

    const paths = [...new Set(outside)];
    return {
      kind: "ask",
      questions: paths.map((path) => `Reaches outside ${cwd}: ${path} ${isHomeOrAbove(path, home) ? PATH_ONLY : TREE}`),
      onAllowSession: () => {
        for (const path of paths) this.allowForSession(path, home);
      },
    };
  }

  private allowForSession(path: string, home: string) {
    if (isHomeOrAbove(path, home)) {
      this.allowedPaths.add(path);
      return;
    }
    this.allowedTrees.add(path);
  }
}

/** True for a call that can't change anything: a reading tool, or a `bash` command that passes the read-only check. */
function onlyReads(toolName: string, input: Record<string, unknown>): boolean {
  if (READING_TOOLS.has(toolName)) return true;
  return toolName === "bash" && typeof input.command === "string" && isReadOnlyCommand(input.command);
}

/** True for the home folder and every folder above it, up to `/`: allowing one of those as a tree allows too much. */
function isHomeOrAbove(path: string, home: string): boolean {
  return isInside(path, home);
}

/** The places a call names, as absolute paths: a `bash` command's, or a `path` input's. MCP tools name none. */
function pathsOf(toolName: string, input: Record<string, unknown>, cwd: string, home: string): string[] {
  if (toolName.startsWith(MCP_PREFIX)) return [];
  if (toolName === "bash" && typeof input.command === "string") {
    return commandPaths(input.command, cwd, home).filter((path) => hasExistingRoot(path, ROOT_DIRS));
  }
  if (typeof input.path === "string") return [resolveToolPath(input.path, cwd, home)];

  return [];
}
