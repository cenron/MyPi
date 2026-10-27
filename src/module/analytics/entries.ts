import { isRecord } from "#core/util/guards";
import { tokenize } from "#core/util/shell";

const MAX_FAILURE_LINE = 120;

/** One model-attributed usage event from the transcript, with no conversation content. */
export type UsageRow = {
  entryId: string;
  isReply: boolean;
  timestamp: number;
  provider: string;
  model: string;
  thinking: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  stopReason: string;
};

/** One tool call from an assistant message, with only the arguments' shape. */
export type ToolCallRow = {
  callId: string;
  timestamp: number;
  provider: string;
  model: string;
  thinking: string;
  tool: string;
  commandNames: string[];
  codeSearch: boolean;
  fromLineOne: boolean;
};

/** A tool result's outcome, linked to its call by id. */
export type ToolResultRow = { callId: string; failed: boolean; failureLine?: string };

/** The analytics rows one complete JSONL line holds. */
export type ParsedEntry = {
  header?: SessionHeader;
  usage?: UsageRow;
  calls?: ToolCallRow[];
  results?: ToolResultRow[];
};

/** Header data needed to associate usage with its session and project. */
export type SessionHeader = { id: string; cwd: string; version: number };

/** Parses one session line into the rows analytics keeps, with the home folder shortened to `~`. */
export function parseEntry(line: string, homeDir: string): ParsedEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  if (value.type === "session") {
    if (typeof value.id !== "string" || typeof value.cwd !== "string") return undefined;
    return { header: { id: value.id, cwd: value.cwd, version: typeof value.version === "number" ? value.version : 1 } };
  }
  if (value.type === "usage") {
    const usage = usageRow(value, value, "usage");
    return usage === undefined ? undefined : { usage };
  }
  if (value.type !== "message" || !isRecord(value.message)) return undefined;

  const message = value.message;
  if (message.role === "toolResult") {
    const result = toolResultRow(message, homeDir);
    return result === undefined ? undefined : { results: [result] };
  }
  if (message.role !== "assistant") return undefined;

  const usage = usageRow(message, value, "assistant");
  const calls = toolCallRows(message, value, homeDir);
  if (usage === undefined && calls.length === 0) return undefined;
  return { usage, calls: calls.length === 0 ? undefined : calls };
}

function usageRow(message: Record<string, unknown>, entry: Record<string, unknown>, kind: string) {
  if (!isRecord(message.usage) || typeof message.provider !== "string" || typeof message.model !== "string") {
    return undefined;
  }
  const usage = message.usage;
  const cost = isRecord(usage.cost) ? usage.cost.total : undefined;
  if (
    typeof usage.input !== "number" ||
    typeof usage.output !== "number" ||
    typeof usage.cacheRead !== "number" ||
    typeof usage.cacheWrite !== "number" ||
    typeof cost !== "number" ||
    typeof entry.id !== "string" ||
    typeof entry.timestamp !== "string"
  ) {
    return undefined;
  }
  const timestamp = Date.parse(entry.timestamp);
  if (Number.isNaN(timestamp)) return undefined;

  return {
    entryId: `${kind}:${entry.id}`,
    isReply: kind === "assistant",
    timestamp,
    provider: message.provider,
    model: message.model,
    thinking: typeof message.thinkingLevel === "string" ? message.thinkingLevel : "unknown",
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost,
    stopReason: typeof message.stopReason === "string" ? message.stopReason : "unknown",
  };
}

function toolCallRows(
  message: Record<string, unknown>,
  entry: Record<string, unknown>,
  homeDir: string,
): ToolCallRow[] {
  if (!Array.isArray(message.content) || typeof entry.timestamp !== "string") return [];
  const timestamp = Date.parse(entry.timestamp);
  if (Number.isNaN(timestamp)) return [];

  const calls: ToolCallRow[] = [];
  for (const block of message.content) {
    if (!isRecord(block) || block.type !== "toolCall" || typeof block.id !== "string") continue;
    if (typeof block.name !== "string") continue;
    const args = isRecord(block.arguments) ? block.arguments : {};
    calls.push({
      callId: block.id,
      timestamp,
      provider: typeof message.provider === "string" ? message.provider : "unknown",
      model: typeof message.model === "string" ? message.model : "unknown",
      thinking: typeof message.thinkingLevel === "string" ? message.thinkingLevel : "unknown",
      tool: block.name,
      commandNames: block.name === "bash" ? commandNames(args.command, homeDir) : [],
      codeSearch: block.name === "bash" && isCodeSearch(args.command),
      fromLineOne: block.name === "read" && startsAtLineOne(args.offset),
    });
  }
  return calls;
}

/** The first word of each shell segment, which is the command name; nothing for a line `tokenize` can't parse. */
function commandNames(command: unknown, homeDir: string): string[] {
  if (typeof command !== "string") return [];
  const segments = tokenize(command);
  if (segments === undefined) return [];
  const names: string[] = [];
  for (const segment of segments) {
    const name = segment.words[0];
    if (name !== undefined) names.push(name.replaceAll(homeDir, "~"));
  }
  return names;
}

/** True for a `bash` line with an `rg` or `grep` command and no `node_modules`, the measuring script's rule. */
function isCodeSearch(command: unknown): boolean {
  if (typeof command !== "string") return false;
  const segments = tokenize(command);
  if (segments === undefined) return false;
  const searches = segments.some(({ words: [name = ""] }) => name === "rg" || name === "grep");
  return searches && !command.includes("node_modules");
}

function startsAtLineOne(offset: unknown): boolean {
  return typeof offset !== "number" || offset <= 1;
}

function toolResultRow(message: Record<string, unknown>, homeDir: string): ToolResultRow | undefined {
  if (typeof message.toolCallId !== "string" || typeof message.isError !== "boolean") return undefined;
  if (!message.isError) return { callId: message.toolCallId, failed: false };
  return { callId: message.toolCallId, failed: true, failureLine: failureLine(message.content, homeDir) };
}

function failureLine(content: unknown, homeDir: string): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content.find((block) => isRecord(block) && block.type === "text" && typeof block.text === "string");
  if (!isRecord(text) || typeof text.text !== "string") return undefined;

  const line = text.text.split("\n")[0]?.replaceAll(homeDir, "~").trim() ?? "";
  return line === "" ? undefined : line.slice(0, MAX_FAILURE_LINE);
}
