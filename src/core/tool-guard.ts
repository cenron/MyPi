import { homedir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolAnnotations,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

/**
 * A rule's answer: no objection, a block with the reason the model sees, or questions for the user. Each question is
 * remembered as its own line for "Allow for this session". Rules may also remember broader approvals with an effect
 * returned by `check`, which the guard runs only after that choice.
 */
export type Verdict =
  | { kind: "allow" }
  | { kind: "block"; reason: string }
  | {
      kind: "ask";
      questions: readonly string[];
      /** Remembers rule-specific approvals only after the user chooses "Allow for this session". */
      onAllowSession?: () => void;
    };

/** A tool call as rules see it; `annotations` are the tool author's hints, unverified. */
export type ToolCall = { toolName: string; input: Record<string, unknown>; annotations?: ToolAnnotations };

/** Where a read-only mode (Plan) still lets a module write: folders (absolute paths) and tools that only write there. */
export type Writable = { readonly dirs: readonly string[]; readonly tools: readonly string[] };

/** What a rule may need beyond the call, passed in so rules stay pure. */
export type ToolEnv = {
  cwd: string;
  home: string;
  /** Every module's writable folders, merged on each call so no rule holds a stale copy. */
  writableDirs: readonly string[];
  /** Every module's writable tools; a Set, because tool names come from the model. */
  writableTools: ReadonlySet<string>;
};

/** A module's objection check, run on every tool call; it must be cheap and side-effect free. */
export type ToolRule = (call: ToolCall, env: ToolEnv) => Verdict;

type ToolApprovalRequest = { name: string; question: string; onAllowSession?: () => void };

/** The guard's dialog choices; pi's own `confirm` is a select with Yes and No, so the dialog looks the same. */
const Choice = {
  YES: "Yes",
  NO: "No",
  ALLOW_SESSION: "Allow for this session",
} as const;

/** Most lines of one ask the dialog shows. More would push its choices off a short terminal and look like a hang. */
const PREVIEW_LINES = 12;

/** Most characters of one line the dialog shows; a longer line wraps into many rows. */
const PREVIEW_LINE_CHARS = 160;

/** Without a UI (a subagent, print mode) an ask is refused, worded so the model takes it to the user, not retries. */
const NO_UI_REFUSAL =
  "Refused: this call needs the user's approval, and no one can give it here (no UI). Tell the user what you needed and why:";

/**
 * `ask` cut down to fit the permission dialog, saying what was left out. Only the display is cut: "Allow for this
 * session" still matches the full text, so two long commands that start alike never share an approval.
 */
export function previewAsk(ask: string): string {
  const lines = ask.split("\n");
  const shown = lines.slice(0, PREVIEW_LINES).map((line) => {
    if (line.length <= PREVIEW_LINE_CHARS) return line;
    return `${line.slice(0, PREVIEW_LINE_CHARS)}… (${line.length - PREVIEW_LINE_CHARS} more characters)`;
  });

  const hidden = lines.length - shown.length;
  if (hidden > 0) shown.push(`… ${hidden} more line${hidden === 1 ? "" : "s"} not shown. Yes allows all of it.`);

  return shown.join("\n");
}

/**
 * Checks each tool call against the modules' rules, by module name: any block wins, and every ask goes into one
 * permission dialog. "Allow for this session" remembers exact ask lines and any rule-specific approvals until `/reload`.
 */
export class ToolGuard {
  private readonly rules = new Map<string, ToolRule>();
  private readonly writables = new Map<string, Writable>();
  /** Ask lines (`<module>: <question>`) allowed for this session. In memory, so `/reload` forgets them. */
  private readonly allowed = new Set<string>();

  constructor(readonly pi: ExtensionAPI) {}

  /** Sets the rule under `name`, or removes it with `undefined`. */
  set(name: string, rule: ToolRule | undefined): void {
    if (rule === undefined) {
      this.rules.delete(name);
      return;
    }

    this.rules.set(name, rule);
  }

  /** Sets what module `name` may write in a read-only mode, or removes it with `undefined`. */
  setWritable(name: string, writable: Writable | undefined): void {
    if (writable === undefined) {
      this.writables.delete(name);
      return;
    }

    this.writables.set(name, writable);
  }

  async check(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    const toolCall = this.toToolCall(ev);
    const writables = [...this.writables.values()];

    const toolEnv: ToolEnv = {
      cwd: ctx.cwd,
      home: homedir(),
      writableDirs: writables.flatMap((writable) => writable.dirs),
      writableTools: new Set(writables.flatMap((writable) => writable.tools)),
    };

    const asks: ToolApprovalRequest[] = [];
    for (const [name, rule] of this.rules) {
      const verdict = rule(toolCall, toolEnv);

      if (verdict.kind === "block") return blocked(verdict.reason);
      if (verdict.kind === "ask") {
        asks.push(...verdict.questions.map((question) => ({ name, question, onAllowSession: verdict.onAllowSession })));
      }
    }

    return this.confirmToolRequests(ctx, asks);
  }

  private async confirmToolRequests(
    ctx: ExtensionContext,
    asks: ToolApprovalRequest[],
  ): Promise<ToolCallEventResult | undefined> {
    // Exact lines, so allowing `npm test` doesn't allow `npm install`. Only asks reach here; a block never does.
    const pending = asks.filter(({ name, question }) => !this.allowed.has(`${name}: ${question}`));
    if (pending.length === 0) return undefined;

    const lines = pending.map(({ name, question }) => `${name}: ${question}`);
    const details = lines.map(previewAsk).join("\n\n");
    if (!ctx.hasUI) return blocked(`${NO_UI_REFUSAL}\n ${details}`);

    // Esc and an abort resolve undefined, which declines like No.
    const choice = await ctx.ui.select(`Permission required\n${details}`, Object.values(Choice), {
      signal: ctx.signal,
    });

    switch (choice) {
      case Choice.ALLOW_SESSION:
        for (const line of lines) this.allowed.add(line);
        for (const onAllowSession of new Set(pending.map((ask) => ask.onAllowSession))) onAllowSession?.();
        return undefined;
      case Choice.YES:
        return undefined;
      default: // No, Esc, or an abort
        return blocked("The user declined this call.");
    }
  }

  /** The call as rules see it, with the annotations pi lists for the tool, if any. */
  private toToolCall(ev: ToolCallEvent): ToolCall {
    const toolInfo = this.pi.getAllTools().find((tool) => tool.name === ev.toolName);
    return { toolName: ev.toolName, input: ev.input, annotations: toolInfo?.annotations };
  }
}

function blocked(reason: string): ToolCallEventResult {
  return { block: true, reason };
}
