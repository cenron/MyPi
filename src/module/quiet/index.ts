import type { AgentToolResult, ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component, Text } from "@earendil-works/pi-tui";
import type { Command, ModuleInfo } from "#core/types";
import { ModuleLoadMode } from "#core/types";
import { isRecord } from "#core/util/guards";
import { FooterColor } from "#ui/footer";
import { reuseText, textOf } from "#ui/render";
import { BaseModule } from "../base";
import { firstLine, summarize } from "./summary";

const QUIET_FOOTER = { text: "QUIET", color: FooterColor.WARNING };
const QUIET_ON_MESSAGE =
  "Quiet on: one line per tool call; failures stay open; Ctrl+O expands; Ctrl+T collapses thinking.";
const QUIET_USAGE = "Usage: /quiet [on|off]";
const quietModules = new WeakMap<ExtensionAPI, QuietModule>();

type QuietRenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type QuietRenderState = {
  callLine?: Text;
  errorReason?: string;
};

/** Keeps tool rows compact without changing the results pi sends to the model. */
export class QuietModule extends BaseModule {
  private quiet = false;

  get info(): ModuleInfo {
    return {
      name: "quiet",
      description: "Draws each tool call and result as a compact status line; failures keep their output.",
      commands: [{ name: "quiet", description: "Toggle compact tool-call rendering" }],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  init(): void {
    const pi = this.session.pi;
    const alreadyRegistered = quietModules.has(pi);
    quietModules.set(pi, this);
    if (alreadyRegistered) return;

    // The extension API keeps resolvers across session_start; route its one resolver to the current module instance.
    pi.registerToolRenderer((toolName, next) => {
      const module = quietModules.get(pi);
      return module ? module.resolveRenderers(toolName, next) : next();
    });
  }

  commands(): Command[] {
    return [
      {
        info: { name: "quiet", description: "Toggle compact tool-call rendering" },
        execute: (_ctx, args) => this.runCommand(args),
      },
    ];
  }

  private runCommand(args: string[]): string {
    if (args.length > 1 || (args.length === 1 && args[0] !== "on" && args[0] !== "off")) return QUIET_USAGE;
    const next = args[0] === "on" ? true : args[0] === "off" ? false : !this.quiet;
    this.setQuiet(next);
    return next ? QUIET_ON_MESSAGE : "Quiet off.";
  }

  private setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    if (!quiet) {
      this.setFooter(undefined);
      return;
    }
    this.setFooter(QUIET_FOOTER);
    this.session.ctx.ui.setToolsExpanded(false);
  }

  private resolveRenderers(toolName: string, next: () => ToolRenderers | undefined): ToolRenderers | undefined {
    const renderers = next();
    if (!this.quiet || this.session.ctx.ui.getToolsExpanded()) return renderers;

    const originalRenderResult = renderers?.renderResult;
    const module = this;
    return {
      ...renderers,
      get renderShell() {
        return module.session.ctx.ui.getToolsExpanded() ? "default" : "self";
      },
      renderCall: (args, theme, context) => this.renderCall(toolName, args, theme, context, renderers?.renderCall),
      ...(originalRenderResult
        ? {
            renderResult: (result, options, theme, context) =>
              this.renderResult(toolName, result, options, theme, context, originalRenderResult),
          }
        : {}),
    };
  }

  private renderCall(
    toolName: string,
    args: unknown,
    theme: Theme,
    context: QuietRenderContext,
    renderCall: ToolRenderers["renderCall"],
  ): Component {
    if (context.expanded) {
      if (renderCall) return renderCall(args, theme, context);
      return reuseText(context.lastComponent, `${toolName}\n\n${JSON.stringify(args, null, 2)}`);
    }

    const summary = displaySummary(toolName, args, context.cwd);
    const state = context.state as QuietRenderState;
    const component = reuseText(
      context.lastComponent,
      this.statusLine(theme, summary, context.isPartial, context.isError, state.errorReason),
    );
    state.callLine = component;
    return component;
  }

  private renderResult(
    toolName: string,
    result: AgentToolResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    context: Parameters<NonNullable<ToolRenderers["renderResult"]>>[3],
    renderResult: NonNullable<ToolRenderers["renderResult"]>,
  ) {
    if (context.expanded || context.isError) {
      if (context.isError && !context.expanded) {
        const state = context.state as QuietRenderState;
        state.errorReason = errorReason(toolName, result);
        if (state.callLine) {
          const summary = displaySummary(toolName, context.args, context.cwd);
          state.callLine.setText(this.statusLine(theme, summary, false, true, state.errorReason));
        }
      }
      return renderResult(result, options, theme, context);
    }

    return reuseText(context.lastComponent, "");
  }

  private statusLine(
    theme: Theme,
    summary: string,
    isPartial: boolean,
    isError: boolean,
    reason: string | undefined,
  ): string {
    if (isPartial) return `${theme.fg("muted", "…")} ${theme.fg("muted", summary)}`;
    if (isError) {
      const suffix = reason ? ` · ${reason}` : "";
      return `${theme.fg("error", "✗")} ${theme.fg("text", `${summary}${suffix}`)}`;
    }
    return `${theme.fg("success", "✓")} ${theme.fg("muted", summary)}`;
  }
}

function displaySummary(toolName: string, args: unknown, cwd: string): string {
  const summary = summarize(toolName, args, cwd) || toolName;
  return summary === toolName || summary.startsWith(`${toolName} `) ? summary : `${toolName} ${summary}`;
}

function errorReason(toolName: string, result: AgentToolResult): string {
  const output = textOf(result.content);
  if (toolName === "bash") {
    const exitCode = output.match(/Command exited with code (\d+)/)?.[1];
    if (exitCode) return `exit ${exitCode}`;
    if (isRecord(result.structuredContent) && typeof result.structuredContent.exit_code === "number") {
      return `exit ${result.structuredContent.exit_code}`;
    }
  }
  const line = firstLine(output.trimStart());
  return line ? line.slice(0, 80) : "failed";
}
