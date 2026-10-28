import type { AgentToolResult, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component, Text } from "@earendil-works/pi-tui";
import type { Command, ModuleInfo } from "#core/types";
import { ModuleLoadMode } from "#core/types";
import { FooterColor } from "#ui/footer";
import { reuseText, textOf } from "#ui/render";
import { BaseModule } from "../base";
import { firstLine, summarize } from "./summary";

const QUIET_FOOTER = { text: "QUIET", color: FooterColor.WARNING };
const QUIET_ON_MESSAGE =
  "Quiet on: one line per tool call; failures stay open; Ctrl+O expands; Ctrl+T collapses thinking.";
const QUIET_USAGE = "Usage: /quiet [on|off]";
/** Longest failure reason beside a red mark. */
const REASON_MAX = 80;
/** The status line pi's bash appends on a non-zero exit (`dist/core/tools/bash.js`). */
const BASH_EXIT_LINE = /Command exited with code (\d+)\s*$/;

type RenderCallContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type RenderResultContext = Parameters<NonNullable<ToolRenderers["renderResult"]>>[3];
/** Where a call stands, which picks its mark and colors. */
type CallStatus = "running" | "done" | "failed";
/** What a row keeps between its call and result drawings, in pi's per-row `state`. */
type RowState = { callLine?: Text; reason?: string };

/** Draws each tool call as one status line; failures keep their output. Only the drawing changes, never the results. */
export class QuietModule extends BaseModule {
  private quiet = false;
  private readonly quietCommand = quietCmd((args) => this.runCommand(args));

  get info(): ModuleInfo {
    return {
      name: "quiet",
      description: "Draws each tool call as one status line; failures keep their output.",
      commands: [this.quietCommand.info],
      loadType: ModuleLoadMode.ALWAYS,
    };
  }

  init(): void {
    this.onToolRender((toolName, next) => this.resolveRenderers(toolName, next));
  }

  commands(): Command[] {
    return [this.quietCommand];
  }

  private runCommand(args: string[]): string {
    const [setting, ...extra] = args;
    if (extra.length > 0 || (setting !== undefined && setting !== "on" && setting !== "off")) return QUIET_USAGE;

    this.setQuiet(setting === undefined ? !this.quiet : setting === "on");
    return this.quiet ? QUIET_ON_MESSAGE : "Quiet off.";
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
    const ui = this.session.ctx.ui;
    if (!this.quiet || ui.getToolsExpanded()) return renderers;

    const renderResult = renderers?.renderResult;
    return {
      ...renderers,
      // A getter: pi reads the shell again on each redraw, so Ctrl+O brings back its padded box on rows drawn quiet.
      get renderShell() {
        return ui.getToolsExpanded() ? "default" : "self";
      },
      renderCall: (args, theme, context) => this.renderCall(toolName, args, theme, context, renderers?.renderCall),
      // Without a result renderer pi draws its own; wrapping nothing would replace that with an empty row.
      ...(renderResult
        ? {
            renderResult: (result, options, theme, context) =>
              this.renderResult(toolName, result, options, theme, context, renderResult),
          }
        : {}),
    };
  }

  private renderCall(
    toolName: string,
    args: unknown,
    theme: Theme,
    context: RenderCallContext,
    renderCall: ToolRenderers["renderCall"],
  ): Component {
    if (context.expanded) {
      if (renderCall) return renderCall(args, theme, context);
      // Once quiet supplies renderCall, pi's own fallback for a tool without one can't run, so draw what it would.
      return reuseText(context.lastComponent, `${toolName}\n\n${JSON.stringify(args, null, 2)}`);
    }

    const state = context.state as RowState;
    const status: CallStatus = context.isPartial ? "running" : context.isError ? "failed" : "done";
    const summary = displaySummary(toolName, args, context.cwd);
    state.callLine = reuseText(context.lastComponent, statusLine(theme, status, summary, state.reason));
    return state.callLine;
  }

  private renderResult(
    toolName: string,
    result: AgentToolResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    context: RenderResultContext,
    renderResult: NonNullable<ToolRenderers["renderResult"]>,
  ): Component {
    if (context.expanded) return renderResult(result, options, theme, context);
    if (!context.isError) return reuseText(context.lastComponent, "");

    // A failure: name the reason on the call's line, and keep the tool's own drawing of the output under it.
    const state = context.state as RowState;
    state.reason = failureReason(result);
    const summary = displaySummary(toolName, context.args, context.cwd);
    state.callLine?.setText(statusLine(theme, "failed", summary, state.reason));
    return renderResult(result, options, theme, context);
  }
}

function quietCmd(run: (args: string[]) => string): Command {
  return {
    info: { name: "quiet", description: "One line per tool call, for this session: /quiet [on|off]" },
    execute: (_ctx, args) => run(args),
  };
}

function statusLine(theme: Theme, status: CallStatus, summary: string, reason: string | undefined): string {
  if (status === "running") return `${theme.fg("muted", "…")} ${theme.fg("muted", summary)}`;
  if (status === "done") return `${theme.fg("success", "✓")} ${theme.fg("muted", summary)}`;
  return `${theme.fg("error", "✗")} ${theme.fg("text", reason ? `${summary} · ${reason}` : summary)}`;
}

/** The summary with the tool's name in front, unless the summary already starts with it. */
function displaySummary(toolName: string, args: unknown, cwd: string): string {
  const summary = summarize(toolName, args, cwd);
  if (!summary) return toolName;
  return summary === toolName || summary.startsWith(`${toolName} `) ? summary : `${toolName} ${summary}`;
}

/**
 * Why a call failed: bash's exit code from the status line pi appends (`Command exited with code N`, the only form
 * that reaches a renderer: `structuredContent` doesn't, seen live 2026-10-27), else the output's first line.
 */
function failureReason(result: AgentToolResult): string {
  const output = textOf(result.content);
  const exitCode = BASH_EXIT_LINE.exec(output)?.[1];
  if (exitCode) return `exit ${exitCode}`;

  return firstLine(output.trimStart()).slice(0, REASON_MAX) || "failed";
}
