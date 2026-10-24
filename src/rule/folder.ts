import { tmpdir } from "node:os";
import type { ToolCall, ToolEnv, Verdict } from "#core/tool-guard";
import { isInside, resolveToolPath } from "#core/util/paths";
import { BaseRule, type RuleInfo } from "./base";

/** MCP tools are named `mcp__<server>__<tool>`; their `path` arguments mean whatever the server says, not a file. */
const MCP_PREFIX = "mcp__";

/** Device files a tool may name without reaching anyone's files. */
const DEVICE_FILES = ["/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr"];

const ALLOW: Verdict = { kind: "allow" };

/**
 * Asks before a call whose `path` input reaches outside the session's folder. Allowed without asking: the modules'
 * own folders, the temp folder (background jobs and web_fetch write there), the `/dev` streams, and the skills and
 * context files pi put in the prompt. The question names the place, not the call, so "Allow for this session" covers
 * every later call that reaches the same path.
 */
export class FolderRule extends BaseRule {
  get info(): RuleInfo {
    return {
      name: "folder-guard",
      description: "Asks before a tool call reaches outside the session's folder, in Plan and Build.",
    };
  }

  check({ toolName, input }: ToolCall, { cwd, home, writableDirs }: ToolEnv): Verdict {
    if (toolName.startsWith(MCP_PREFIX) || typeof input.path !== "string") return ALLOW;

    const path = resolveToolPath(input.path, cwd, home);
    const allowed = [cwd, ...writableDirs, tmpdir(), ...DEVICE_FILES, ...this.prompt.paths];
    if (allowed.some((dir) => isInside(dir, path))) return ALLOW;

    return { kind: "ask", question: `Reaches outside ${cwd}: ${path}` };
  }
}
