import * as os from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolAnnotations,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

export type Verdict = { kind: "allow" } | { kind: "block"; reason: string } | { kind: "ask"; question: string };
export type ToolCall = { toolName: string; input: Record<string, unknown>; annotations?: ToolAnnotations };
export type ToolEnv = { cwd: string; home: string };
export type ToolRule = (call: ToolCall, env: ToolEnv) => Verdict;

type ToolApprovalRequest = { name: string; question: string };

/** The guard's dialog choices; pi's own `confirm` is a select with Yes and No, so the dialog looks the same. */
const Choice = {
  YES: "Yes",
  NO: "No",
  ALLOW_SESSION: "Allow for this session",
} as const;

const returnBlock = (reason: string): ToolCallEventResult => {
  return { block: true, reason };
};

export class ToolGuard {
  private readonly rules: Map<string, ToolRule> = new Map<string, ToolRule>();
  /** Ask lines (`<module>: <question>`) allowed for this session. In memory, so `/reload` forgets them. */
  private readonly allowed = new Set<string>();

  constructor(readonly pi: ExtensionAPI) {}

  public set(name: string, rule: ToolRule | undefined) {
    if (rule === undefined) return this.rules.delete(name);
    return this.rules.set(name, rule);
  }

  public async check(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    const toolInfo = this.pi.getAllTools().find((tool) => tool.name === ev.toolName);
    const toolCall: ToolCall = { toolName: ev.toolName, input: ev.input, annotations: toolInfo?.annotations };
    const toolEnv: ToolEnv = { cwd: ctx.cwd, home: os.homedir() };

    const asks: ToolApprovalRequest[] = [];
    for (const [name, rule] of this.rules) {
      const verdict = rule(toolCall, toolEnv);
      if (verdict.kind === "block") return returnBlock(verdict.reason);
      if (verdict.kind === "ask") asks.push({ name: name, question: verdict.question });
    }

    return this.confirmToolRequests(ctx, asks);
  }

  private async confirmToolRequests(
    ctx: ExtensionContext,
    asks: ToolApprovalRequest[],
  ): Promise<ToolCallEventResult | undefined> {
    // Exact lines, so allowing `npm test` doesn't allow `npm install`. Only asks reach here; a block never does.
    const lines = asks.map(({ name, question }) => `${name}: ${question}`).filter((line) => !this.allowed.has(line));
    if (lines.length === 0) return undefined;

    const details = lines.join("\n\n");
    if (!ctx.hasUI) return returnBlock(`Confirmation needed, no UI to ask:\n ${details}`);

    // Esc and an abort resolve undefined, which declines like No.
    const choice = await ctx.ui.select(`Permission required\n${details}`, Object.values(Choice), {
      signal: ctx.signal,
    });

    switch (choice) {
      case Choice.ALLOW_SESSION:
        for (const line of lines) this.allowed.add(line);
        return undefined;
      case Choice.YES:
        return undefined;
      default: // No, Esc, or an abort
        return returnBlock("The user declined this call.");
    }
  }
}
