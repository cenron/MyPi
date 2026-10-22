import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import mypi from "../../index";
import { fakeUI } from "../fakes";

const calls: string[] = [];

// Gives web_fetch hooks, so the test sees when MyPi runs them relative to registration.
vi.mock("#tool/web-fetch/index", () => ({
  webFetchTool: () => ({
    definition: { name: "web_fetch" },
    init: () => calls.push("init"),
    shutdown: () => calls.push("shutdown"),
  }),
}));

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

describe("built-in tool hooks", () => {
  it("runs init() after every tool is registered and before the modules' init(), and shutdown() on shutdown", () => {
    const handlers = new Map<string, Handler>();
    const pi = {
      on: (event: string, handler: Handler) => {
        if (!handlers.has(event)) handlers.set(event, handler);
        return () => {};
      },
      registerCommand: () => {},
      registerTool: (tool: ToolDefinition) => calls.push(`register ${tool.name}`),
      getAllTools: () => [],
      getActiveTools: () => [],
      // plan-build's init() turns its tools on here, one call per tool.
      setActiveTools: () => calls.push("module init"),
      sendUserMessage: () => {},
    } as unknown as ExtensionAPI;
    const ctx = { hasUI: true, ui: fakeUI(), cwd: "/project", sessionManager: { getBranch: () => [] } };
    mypi(pi);

    handlers.get("session_start")?.({ type: "session_start", reason: "startup" }, ctx as unknown as ExtensionContext);
    expect(calls).toEqual([
      "register web_search",
      "register web_fetch",
      "register submit_plan",
      "register ask_user",
      "init",
      "module init",
      "module init",
    ]);

    handlers.get("session_shutdown")?.(
      { type: "session_shutdown", reason: "quit" },
      ctx as unknown as ExtensionContext,
    );
    expect(calls.at(-1)).toBe("shutdown");
  });
});
