import type { ToolRule, Verdict } from "#core/tool-guard";
import { isInside, resolveToolPath } from "#core/util/paths";
import { isReadOnlyCommand } from "#core/util/shell";

/**
 * Tools Plan never objects to. Pi's built-in readers carry no annotations, so they're listed by name; `codemode`'s
 * nested calls each pass through the guard under their own tool name. `ask_user` only asks. Tools that write, such as
 * `submit_plan`, come from the modules' writables instead.
 */
const ALLOWED = new Set(["read", "grep", "find", "ls", "tool_search", "codemode", "ask_user"]);

const ALLOW: Verdict = { kind: "allow" };

/** What Plan allows, by tool: the Plan rule in docs/modules/plan-build.md. Build has no rule. */
export const planRule: ToolRule = ({ toolName, input, annotations }, { cwd, home, writableDirs, writableTools }) => {
  if (ALLOWED.has(toolName) || writableTools.has(toolName)) return ALLOW;

  switch (toolName) {
    case "edit":
    case "write": {
      // Pi validates the input before tool_call, so `path` is a string; anything else blocks.
      const path = input.path;
      if (typeof path === "string") {
        const file = resolveToolPath(path, cwd, home);
        if (writableDirs.some((dir) => isInside(dir, file))) return ALLOW;
      }

      return {
        kind: "block",
        reason:
          `Plan mode is on, so ${toolName} only works inside ${writableDirs.join(", ")}, not on ${String(path)}. ` +
          "Don't try another way to change it; keep planning, and the user switches to Build to implement.",
      };
    }
    case "bash": {
      const command = input.command;
      if (typeof command === "string" && isReadOnlyCommand(command)) return ALLOW;
      return { kind: "ask", question: `Plan mode is on. Run this command?\n${String(command)}` };
    }
    case "powershell":
      return { kind: "ask", question: `Plan mode is on. Run this PowerShell command?\n${String(input.command)}` };
    default:
      if (annotations?.readOnlyHint === true) return ALLOW;
      return { kind: "ask", question: `Plan mode is on. Allow ${toolName}? It isn't marked read-only.` };
  }
};
