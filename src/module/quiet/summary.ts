import { isAbsolute, relative, resolve, sep } from "node:path";
import { isRecord } from "#core/util/guards";

/** Keep tool summaries on one line without spending the rest of the row on a long command. */
export const SUMMARY_MAX = 80;
const TASK_WORDS = 6;

/** A short call label, with file paths shown relative to the call's working directory when possible. */
export function summarize(toolName: string, args: unknown, cwd: string): string {
  const values = isRecord(args) ? args : {};
  if (["read", "edit", "write", "lsp_edit"].includes(toolName)) {
    return relativePath(stringValue(values.path ?? values.file_path), cwd);
  }
  if (toolName === "bash") return short(firstLine(stringValue(values.command)));
  if (toolName === "grep" || toolName === "find") {
    return [stringValue(values.pattern), stringValue(values.path)].filter(Boolean).join(" in ");
  }
  if (toolName === "web_search") return short(stringValue(values.query));
  if (toolName === "web_fetch") return fetchPath(stringValue(values.url));
  if (toolName === "subagent") {
    const task = stringValue(values.task).split(/\s+/).slice(0, TASK_WORDS).join(" ");
    return [stringValue(values.agent), task].filter(Boolean).join(" · ");
  }
  if (toolName === "task_create") return short(stringValue(values.subject));
  if (toolName === "task_update") {
    const id = stringValue(values.taskId);
    return [stringValue(values.subject) || id, stringValue(values.status)].filter(Boolean).join(" · ");
  }
  const firstArgument = Object.values(values).find((value) => typeof value === "string");
  return [toolName, short(stringValue(firstArgument))].filter(Boolean).join(" ");
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Shares line extraction between tool summaries and failure reasons. */
export function firstLine(value: string): string {
  return value.split("\n", 1)[0] ?? "";
}

function relativePath(path: string, cwd: string): string {
  if (!path) return "";
  const absolute = resolve(cwd, path);
  const fromCwd = relative(resolve(cwd), absolute);
  if (!isAbsolute(fromCwd) && fromCwd !== ".." && !fromCwd.startsWith(`..${sep}`)) {
    return fromCwd || path;
  }
  return path;
}

function fetchPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return short(url);
  }
}

function short(value: string): string {
  if (value.length <= SUMMARY_MAX) return value;
  return `${value.slice(0, SUMMARY_MAX - 1)}…`;
}
