import { resolve } from "node:path";
import { isRecord } from "#core/util/guards";
import { displayPath } from "#core/util/paths";

/** Keeps a summary on one line without spending the row on a long command. */
export const SUMMARY_MAX = 80;
const TASK_WORDS = 6;

/**
 * A short call label, with file paths shown relative to the call's working directory when possible. Every label is cut
 * to `SUMMARY_MAX`, so a long path, pattern, or URL can't wrap the row onto a second line.
 */
export function summarize(toolName: string, args: unknown, cwd: string): string {
  return short(label(toolName, isRecord(args) ? args : {}, cwd));
}

/** A tool result's first line: the part of a failure worth showing beside its mark. */
export function firstLine(value: string): string {
  return value.split("\n", 1)[0] ?? "";
}

function label(toolName: string, values: Record<string, unknown>, cwd: string): string {
  if (["read", "edit", "write", "lsp_edit"].includes(toolName)) {
    const path = stringValue(values.path ?? values.file_path);
    return path && displayPath(resolve(cwd, path), cwd);
  }
  if (toolName === "bash") return firstLine(stringValue(values.command));
  if (toolName === "grep" || toolName === "find") {
    return [stringValue(values.pattern), stringValue(values.path)].filter(Boolean).join(" in ");
  }
  if (toolName === "web_search") return stringValue(values.query);
  if (toolName === "web_fetch") return fetchPath(stringValue(values.url));
  if (toolName === "subagent") {
    const task = stringValue(values.task).split(/\s+/).slice(0, TASK_WORDS).join(" ");
    return [stringValue(values.agent), task].filter(Boolean).join(" · ");
  }
  if (toolName === "task_create") return stringValue(values.subject);
  if (toolName === "task_update") {
    return [stringValue(values.subject) || stringValue(values.taskId), stringValue(values.status)]
      .filter(Boolean)
      .join(" · ");
  }
  const firstArgument = Object.values(values).find((value) => typeof value === "string");
  return [toolName, stringValue(firstArgument)].filter(Boolean).join(" ");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function fetchPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function short(value: string): string {
  if (value.length <= SUMMARY_MAX) return value;
  return `${value.slice(0, SUMMARY_MAX - 1)}…`;
}
