import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { SubagentsModule } from "#module/subagents/index";
import { fakeSession } from "../../fakes";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("registers the deferred manager, approval rule, writable folders, and updated prompt section", () => {
  vi.spyOn(ModelRuntime, "create").mockResolvedValue({} as ModelRuntime);
  const fake = fakeSession([], "/project");
  const setWritable = vi.spyOn(fake.session.toolGuard, "setWritable");
  const setRule = vi.spyOn(fake.session.toolGuard, "set");
  const module = new SubagentsModule(fake.session);
  module.init();

  const manager = module.tools().find((tool) => tool.name === "agent_manage");
  expect(manager?.exposure).toBe("deferred");
  expect(setWritable).toHaveBeenCalledWith("subagents", {
    dirs: [expect.stringMatching(/\/agents$/), "/project/.pi/agents"],
    tools: ["agent_manage"],
  });
  expect(setRule).toHaveBeenCalledWith("subagents", expect.any(Function));
  const prompt: Record<string, string> = {};
  fake.session.promptManager.apply(prompt);
  expect(prompt["mypi-subagents"]).toContain("find `agent_manage` with `tool_search`");
});
