import type { Theme, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { reuseText } from "#ui/render";
import type { BackgroundDetails } from "./index";

/** The call's arguments as the renderer sees them: they may be partial while the model is still writing them. */
type CallArgs = { command?: string; background?: boolean };

/**
 * Draws background `bash` calls as `$ <command> (background)` and their result as `job <id> started · <log file>`;
 * every other call, and an error, is drawn by `next()`, pi's own `bash` renderer. Other tools get `next()` as is.
 */
export const backgroundRenderer: ToolRendererResolver = (toolName, next) => {
  const piRenderer = next();
  if (toolName !== "bash" || !piRenderer?.renderCall || !piRenderer.renderResult) return piRenderer;

  const { renderCall, renderResult } = piRenderer;
  return {
    ...piRenderer,
    renderCall(args, theme, context) {
      if (!(args as CallArgs).background) return renderCall(args, theme, context);
      return reuseText(context.lastComponent, formatBackgroundCall(args as CallArgs, theme));
    },
    renderResult(result, options, theme, context) {
      const details = result.details as Partial<BackgroundDetails> | undefined;
      if (context.isError || !details?.jobId || !details.logPath) return renderResult(result, options, theme, context);
      return reuseText(
        context.lastComponent,
        formatBackgroundResult({ jobId: details.jobId, logPath: details.logPath }, theme),
      );
    },
  };
};

/** The call line for a background command: `$ <command> (background)`, in pi's shell call style. */
function formatBackgroundCall(args: CallArgs, theme: Theme): string {
  return theme.fg("toolTitle", theme.bold(`$ ${args.command ?? "..."}`)) + theme.fg("dim", " (background)");
}

/** The result line for a background start: `job <id> started · <log file>`. */
function formatBackgroundResult({ jobId, logPath }: BackgroundDetails, theme: Theme): string {
  return `\n${theme.fg("muted", `job ${jobId} started · ${logPath}`)}`;
}
