import { type ExtensionCommandContext, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, it, vi } from "vitest";
import { SubagentsModule } from "#module/subagents/index";
import { fakeSession } from "../../fakes";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("registers /agents and lists the loaded agents", async () => {
  vi.spyOn(ModelRuntime, "create").mockResolvedValue({} as ModelRuntime);
  const fake = fakeSession([], "/project");
  const module = new SubagentsModule(fake.session);
  module.init();
  const command = module.commands()[0];
  let listing = "";
  const ctx = {
    ...fake.session.ctx,
    mode: "tui",
    ui: {
      ...fake.session.ctx.ui,
      custom: async (
        factory: (
          tui: never,
          theme: never,
          keybindings: never,
          done: (result: undefined) => void,
        ) => { render(width: number): string[] },
      ) => {
        const component = factory(
          { requestRender() {} } as never,
          { ...fake.session.ctx.ui.theme, bg: (_color: string, text: string) => text } as never,
          {} as never,
          () => {},
        );
        listing = component.render(120).join("\\n");
        return undefined;
      },
    },
  } as unknown as ExtensionCommandContext;

  expect(command?.info.name).toBe("agents");
  await command?.execute(ctx, []);

  expect(listing).toContain("explore");
  expect(listing).toContain("developer");
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
