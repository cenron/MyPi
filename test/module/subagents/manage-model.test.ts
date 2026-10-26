import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { actualThinking, matchAgentModel, resolveAgentModel } from "#module/subagents/manage-model";

const model = (provider: string, id: string, name: string, reasoning = true) =>
  ({ provider, id, name, reasoning }) as Model<Api>;

const models = [model("openai", "gpt-6-luna", "Luna 6"), model("other", "gpt-6-luna-pro", "Luna 6 Pro")];

describe("matchAgentModel", () => {
  it.each([
    ["one loose match", "Luna 6 Pro", "other/gpt-6-luna-pro"],
    ["exact canonical ID", "openai/gpt-6-luna", "openai/gpt-6-luna"],
  ])("resolves %s", (_label, query, expected) => {
    const result = matchAgentModel(models, query);
    expect(result).not.toBe("inherit");
    if (result !== "inherit") expect(`${result.provider}/${result.id}`).toBe(expected);
  });

  it("returns the unique match from the runtime catalog", () => {
    const runtime = { getModels: () => models } as unknown as ModelRuntime;
    expect(resolveAgentModel(runtime, "Luna 6 Pro")).toBe(models[1]);
  });

  it("matches loose words regardless of their order in the model ID", () => {
    const result = matchAgentModel(models.slice(0, 1), "luna 6");
    expect(result).not.toBe("inherit");
    if (result !== "inherit") expect(`${result.provider}/${result.id}`).toBe("openai/gpt-6-luna");
  });

  it("keeps inherit as an explicit setting", () => {
    expect(matchAgentModel(models, "inherit")).toBe("inherit");
  });

  it.each([
    ["none", "missing", "matched no models: none"],
    ["several", "Luna 6", "matched several models: openai/gpt-6-luna, other/gpt-6-luna-pro"],
  ])("reports %s matches", (_label, query, message) => {
    expect(() => matchAgentModel(models, query)).toThrow(message);
  });
});

it("shows the supported thinking level while leaving the requested setting alone", () => {
  const noReasoning = model("provider", "small", "Small", false);
  expect(actualThinking(noReasoning, "high")).toBe("off");
});
