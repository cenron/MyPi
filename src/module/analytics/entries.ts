import { isRecord } from "#core/util/guards";

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

/** Header data needed to associate usage with its session and project. */
export type SessionHeader = { id: string; cwd: string; version: number };

/** A complete JSONL line's analytics data, if it is a session header or a usage event. */
export function parseEntry(line: string): { header?: SessionHeader; usage?: UsageRow } | undefined {
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
  if (value.type === "usage") return usageRow(value, value, "usage");
  if (value.type !== "message" || !isRecord(value.message) || value.message.role !== "assistant") return undefined;
  return usageRow(value.message, value, "assistant");
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
    usage: {
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
    },
  };
}
