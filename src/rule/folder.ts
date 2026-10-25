import { tmpdir } from "node:os";
import type { ToolCall, ToolEnv, Verdict } from "#core/tool-guard";
import { commandPaths, isInside, resolveToolPath } from "#core/util/paths";
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

const ALLOW: Verdict = { kind: "allow" };

/**
 * Asks before a call that reaches outside the session's folder: a `path` input, or the places a `bash` command names
 * (`commandPaths`). Allowed without asking: the modules' own folders, the temp folder (background jobs and web_fetch
 * write there) and `/tmp`, the `/dev` streams, and the skills and context files pi put in the prompt. Each question names one
 * place, not the call, so "Allow for this session" covers that path and its whole tree across tools.
 */
export class FolderRule extends BaseRule {
  private readonly sessionAllowed = new Set<string>();

  get info(): RuleInfo {
    return {
      name: "folder-guard",
      description: "Asks before a tool call reaches outside the session's folder, in Plan and Build.",
    };
  }

  check({ toolName, input }: ToolCall, { cwd, home, writableDirs }: ToolEnv): Verdict {
    const allowed = [
      cwd,
      ...writableDirs,
      tmpdir(),
      ...SCRATCH_DIRS,
      ...DEVICE_FILES,
      ...this.prompt.paths,
      ...this.sessionAllowed,
    ];
    const outside = pathsOf(toolName, input, cwd, home).filter((path) => !allowed.some((dir) => isInside(dir, path)));
    if (outside.length === 0) return ALLOW;

    const paths = [...new Set(outside)];
    return {
      kind: "ask",
      questions: paths.map((path) => `Reaches outside ${cwd}: ${path} (and anything under it)`),
      onAllowSession: () => {
        for (const path of paths) this.sessionAllowed.add(path);
      },
    };
  }
}

/** The places a call names, as absolute paths: a `bash` command's, or a `path` input's. MCP tools name none. */
function pathsOf(toolName: string, input: Record<string, unknown>, cwd: string, home: string): string[] {
  if (toolName.startsWith(MCP_PREFIX)) return [];
  if (toolName === "bash" && typeof input.command === "string") return commandPaths(input.command, cwd, home);
  if (typeof input.path === "string") return [resolveToolPath(input.path, cwd, home)];

  return [];
}
