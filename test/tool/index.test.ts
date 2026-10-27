import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { ModuleLoadMode } from "#core/types";
import { registerTools, shutdownTools } from "#tool/index";
import type { Tool } from "#tool/types";
import { fakeModule, fakeSession } from "../fakes";

/** A built-in tool named `name` whose hooks append to `calls`. */
const hookedTool = (name: string, calls: string[]): Tool => ({
  definition: { name } as Tool["definition"],
  init: () => calls.push(`${name} init`),
  shutdown: () => calls.push(`${name} shutdown`),
});

describe("registerTools", () => {
  // MyPi keeps the list to run the built-ins' hooks; module tools have their module's init() instead.
  it("registers a built-in tool's rule on the guard under its name", async () => {
    const { session } = fakeSession();
    registerTools(session.pi, session);
    const call = (toolName: string, toolCallId: string, parentToolCallId?: string) =>
      ({ type: "tool_call", toolName, toolCallId, parentToolCallId, input: {} }) as ToolCallEvent;

    await session.toolGuard.check(call("web_search", "search"), session.ctx);
    await expect(
      session.toolGuard.check(call("mcp__exa__web_search_exa", "nested", "search"), session.ctx),
    ).resolves.toBeUndefined();

    await expect(
      session.toolGuard.check(call("mcp__exa__web_search_exa", "direct"), session.ctx),
    ).resolves.toMatchObject({
      block: true,
      reason: expect.stringContaining("Use web_search:"),
    });
  });

  it("leaves a module's rule alone when a built-in tool of the same name has none", async () => {
    const { session } = fakeSession();
    session.toolGuard.set("web_fetch", () => ({ kind: "block", reason: "a module's rule" }));
    registerTools(session.pi, session);
    const call = { type: "tool_call", toolName: "read", toolCallId: "read", input: {} } as unknown as ToolCallEvent;

    await expect(session.toolGuard.check(call, session.ctx)).resolves.toMatchObject({ reason: "a module's rule" });
  });

  it("returns the built-in tools only", () => {
    const { session } = fakeSession();
    session.moduleManager.start([fakeModule("core", ModuleLoadMode.ALWAYS)], "startup");
    expect(registerTools(session.pi, session).map((tool) => tool.definition.name)).toEqual([
      "bash",
      "job_list",
      "job_wait",
      "job_stop",
      "web_search",
      "web_fetch",
    ]);
  });
});

describe("shutdownTools", () => {
  // A tool that fails to clean up mustn't leave the next one's processes running.
  it("logs a shutdown() that throws and still shuts the rest down", () => {
    const calls: string[] = [];
    const { session, notify } = fakeSession();
    const broken: Tool = {
      definition: { name: "broken" } as Tool["definition"],
      shutdown: () => {
        throw new Error("kill failed");
      },
    };
    shutdownTools([broken, hookedTool("a", calls)], session);
    expect(calls).toEqual(["a shutdown"]);
    expect(notify).toHaveBeenCalledWith("broken shutdown: kill failed", "error");
  });
});
