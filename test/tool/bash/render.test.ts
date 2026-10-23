import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { backgroundRenderer } from "#tool/bash/render";

const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `**${text}**`,
} as unknown as Theme;

/** pi's own renderers, faked: each returns a Text naming itself. */
function piRenderers() {
  return {
    renderCall: vi.fn(() => new Text("pi call", 0, 0)),
    renderResult: vi.fn(() => new Text("pi result", 0, 0)),
  } as unknown as ToolRenderers & { renderCall: ReturnType<typeof vi.fn>; renderResult: ReturnType<typeof vi.fn> };
}

const context = (isError = false) => ({ lastComponent: undefined, isError }) as never;
const drawn = (component: { render(width: number): string[] } | undefined) => component?.render(200).join("\n").trim();

describe("backgroundRenderer", () => {
  it("draws a background call and its start", () => {
    const pi = piRenderers();
    const renderers = backgroundRenderer("bash", () => pi);
    const call = renderers?.renderCall?.({ command: "npm run dev", background: true }, theme, context());
    expect(drawn(call)).toBe("<toolTitle>**$ npm run dev**</toolTitle><dim> (background)</dim>");
    const result = { content: [], details: { jobId: "1", logPath: "/tmp/pi-job-1.log" } };
    const shown = renderers?.renderResult?.(result, { expanded: false, isPartial: false }, theme, context());
    expect(drawn(shown)).toBe("<muted>job 1 started · /tmp/pi-job-1.log</muted>");
    expect(pi.renderCall).not.toHaveBeenCalled();
    expect(pi.renderResult).not.toHaveBeenCalled();
  });

  it("leaves foreground calls, errors, and other tools to pi's renderers", () => {
    const pi = piRenderers();
    const renderers = backgroundRenderer("bash", () => pi);
    expect(drawn(renderers?.renderCall?.({ command: "ls" }, theme, context()))).toBe("pi call");
    const failed = { content: [], details: { jobId: "1", logPath: "/tmp/pi-job-1.log" } };
    const options = { expanded: false, isPartial: false };
    expect(drawn(renderers?.renderResult?.(failed, options, theme, context(true)))).toBe("pi result");
    expect(drawn(renderers?.renderResult?.({ content: [], details: undefined }, options, theme, context()))).toBe(
      "pi result",
    );
    const other = piRenderers();
    expect(backgroundRenderer("read", () => other)).toBe(other);
  });
});
