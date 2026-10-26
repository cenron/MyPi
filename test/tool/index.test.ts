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
