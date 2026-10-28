import {
  initTheme,
  type Theme,
  ToolExecutionComponent,
  type ToolRendererResolver,
  type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { QuietModule } from "#module/quiet/index";
import { fakeSession, fakeToolRenderers } from "../../fakes";

const theme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => text,
} as unknown as Theme;

function setup() {
  const fake = fakeSession();
  const getToolsExpanded = vi.fn(() => false);
  const setToolsExpanded = vi.fn();
  Object.assign(fake.session.ctx.ui, { getToolsExpanded, setToolsExpanded });
  const module = new QuietModule(fake.session);
  module.init();
  const resolver: ToolRendererResolver = (toolName, next) => fake.session.renderers.resolve(toolName, next);
  const quiet = module.commands()[0];
  if (!quiet) throw new Error("Quiet didn't register its command");
  const run = (...args: string[]) => quiet.execute({} as never, args);
  return { ...fake, module, resolver, run, getToolsExpanded, setToolsExpanded };
}

function context(
  options: { expanded?: boolean; isPartial?: boolean; isError?: boolean } = {},
): Parameters<NonNullable<ToolRenderers["renderCall"]>>[2] {
  return {
    args: { path: "src/a.ts" },
    cwd: "/project",
    expanded: options.expanded ?? false,
    isPartial: options.isPartial ?? false,
    isError: options.isError ?? false,
    state: {},
    lastComponent: undefined,
  } as Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
}

function drawn(component: { render(width: number): string[] } | undefined): string {
  return component?.render(200).join("\n").trim() ?? "";
}

beforeAll(() => initTheme("dark"));

describe("QuietModule", () => {
  it("registers a renderer, stays off at startup, and returns next renderers unchanged", () => {
    const { resolver } = setup();
    const original = fakeToolRenderers();
    expect(resolver("read", () => original)).toBe(original);
  });

  it("draws a muted in-progress summary and a green success mark", () => {
    const { resolver, run } = setup();
    run("on");
    const original = fakeToolRenderers();
    const wrapped = resolver("read", () => original);
    expect(wrapped?.renderShell).toBe("self");
    const partialCall = wrapped?.renderCall?.({ path: "src/a.ts" }, theme, context({ isPartial: true }));
    expect(drawn(partialCall)).toBe("<muted>…</muted> <muted>read src/a.ts</muted>");
    const successfulCall = wrapped?.renderCall?.({ path: "src/a.ts" }, theme, context({ isPartial: false }));
    expect(drawn(successfulCall)).toBe("<success>✓</success> <muted>read src/a.ts</muted>");
    const hiddenResult = wrapped?.renderResult?.(
      { content: [{ type: "text", text: "success output" }], details: undefined },
      { expanded: false, isPartial: false },
      theme,
      context(),
    );
    expect(drawn(hiddenResult)).toBe("");
  });

  it("keeps failed output open and adds bash's exit code to the red-marked line", () => {
    const { resolver, run } = setup();
    run("on");
    const original = fakeToolRenderers();
    const wrapped = resolver("bash", () => original);
    const failureContext = { ...context({ isError: true }), args: { command: "false" } } as never;
    const call = wrapped?.renderCall?.({ command: "false" }, theme, failureContext);
    const shown = wrapped?.renderResult?.(
      {
        content: [{ type: "text", text: "(no output)\n\nCommand exited with code 1" }],
        details: undefined,
      },
      { expanded: false, isPartial: false },
      theme,
      failureContext,
    );
    expect(drawn(shown)).toBe("pi result");
    expect(drawn(call)).toBe("<error>✗</error> <text>bash false · exit 1</text>");
  });

  it("keeps pi's built-in failure output when next has no result renderer", () => {
    const { resolver, run } = setup();
    run("on");
    const wrapped = resolver("custom_tool", () => undefined);
    const component = new ToolExecutionComponent(
      "custom_tool",
      "call-1",
      { action: "fail" },
      { outputPad: 0 },
      wrapped,
      { requestRender: vi.fn() } as never,
      "/project",
    );
    component.updateResult({ content: [{ type: "text", text: "failure detail" }], isError: true });
    expect(component.render(200).join("\\n")).toContain("failure detail");
  });

  it("uses the original renderer when the row is expanded", () => {
    const { resolver, run, getToolsExpanded } = setup();
    run("on");
    const original = fakeToolRenderers();
    expect(
      resolver("read", () => original)?.renderCall?.({ path: "src/a.ts" }, theme, context({ expanded: true })),
    ).toBeInstanceOf(Text);
    expect(original.renderCall).toHaveBeenCalledOnce();
    const expandedResult = resolver("read", () => original)?.renderResult?.(
      { content: [{ type: "text", text: "expanded output" }], details: undefined },
      { expanded: true, isPartial: false },
      theme,
      context({ expanded: true }),
    );
    expect(drawn(expandedResult)).toBe("pi result");
    expect(original.renderResult).toHaveBeenCalledOnce();
    const expandedFailure = resolver("bash", () => original)?.renderCall?.(
      { command: "false" },
      theme,
      context({ expanded: true, isError: true }),
    );
    expect(drawn(expandedFailure)).toBe("pi call");
    const wrapped = resolver("read", () => original);
    expect(wrapped?.renderShell).toBe("self");
    getToolsExpanded.mockReturnValue(true);
    expect(wrapped?.renderShell).toBe("default");
    expect(resolver("read", () => original)).toBe(original);
  });

  it("turns on, off, toggles, and rejects other arguments; the footer follows the state", () => {
    const { run, setStatus, setToolsExpanded } = setup();
    expect(run("on")).toBe(
      "Quiet on: one line per tool call; failures stay open; Ctrl+O expands; Ctrl+T collapses thinking.",
    );
    expect(setStatus).toHaveBeenLastCalledWith("mypi-quiet", "<warning>QUIET");
    expect(setToolsExpanded).toHaveBeenCalledExactlyOnceWith(false);
    expect(run("off")).toBe("Quiet off.");
    expect(setStatus).toHaveBeenLastCalledWith("mypi-quiet", undefined);
    expect(setToolsExpanded).toHaveBeenCalledOnce();
    expect(run()).toContain("Quiet on:");
    expect(run()).toBe("Quiet off.");
    expect(run("maybe")).toBe("Usage: /quiet [on|off]");
    expect(setStatus).toHaveBeenLastCalledWith("mypi-quiet", undefined);
  });
});
