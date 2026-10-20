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

type AskType = { name: string; question: string };
const returnBlock = (r: string): ToolCallEventResult => {
  return { block: true, reason: r };
};

export class ToolGuard {
  private readonly rules: Map<string, ToolRule> = new Map<string, ToolRule>();

  constructor(readonly pi: ExtensionAPI) {}

  public set(name: string, rule: ToolRule | undefined) {
    if (rule === undefined) return this.rules.delete(name);

    return this.rules.set(name, rule);
  }

  public async check(ev: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> {
    const toolInfo = this.pi.getAllTools().find((tool) => tool.name === ev.toolName);
    const toolCall: ToolCall = { toolName: ev.toolName, input: ev.input, annotations: toolInfo?.annotations };
    const toolEnv: ToolEnv = { cwd: ctx.cwd, home: os.homedir() };

    const asks: AskType[] = [];
    for (const [name, rule] of this.rules) {
      const verdict = rule(toolCall, toolEnv);
      if (verdict.kind === "block") return returnBlock(verdict.reason);
      if (verdict.kind === "ask") asks.push({ name: name, question: verdict.question });
    }

    return this.confirmToolRequests(ctx, asks);
  }

  private async confirmToolRequests(ctx: ExtensionContext, asks: AskType[]): Promise<ToolCallEventResult | undefined> {
    if (asks.length === 0) return undefined;

    const details = asks.map(({ name, question }) => `${name}: ${question}`).join("\n\n");
    if (!ctx.hasUI) return returnBlock(`Confirmation needed, no UI to ask:\n ${details}`);

    const ok = await ctx.ui.confirm("Permission required", details, { signal: ctx.signal });
    return ok ? undefined : returnBlock("The user declined this call.");
  }
}
