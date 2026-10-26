import { type Api, clampThinkingLevel, type Model, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Resolves a loose model name only when it identifies exactly one model pi can use. */
export function resolveAgentModel(runtime: ModelRuntime, query: string): Model<Api> {
  const match = matchAgentModel(runtime.getModels(), query);
  if (match === "inherit") throw new Error("Use the current model directly for 'inherit'.");
  return match;
}

/** A loose model query must identify one available model; inherit is represented explicitly. */
export function matchAgentModel(models: readonly Model<Api>[], query: string): Model<Api> | "inherit" {
  if (query === "inherit") return "inherit";
  const normalizedQuery = query.toLowerCase();
  const exact = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === normalizedQuery);
  const terms = normalizedQuery.match(/[a-z0-9]+/g) ?? [];
  const matches = exact.length
    ? exact
    : models.filter((model) => {
        const label = `${model.provider}/${model.id} ${model.name}`.toLowerCase();
        return terms.length > 0 && terms.every((term) => label.includes(term));
      });
  if (matches.length !== 1) {
    const found = matches.map((model) => `${model.provider}/${model.id}`).join(", ") || "none";
    throw new Error(
      `Model '${query}' matched ${matches.length === 0 ? "no models" : "several models"}: ${found}. Give an exact provider/id.`,
    );
  }
  return matches[0] as Model<Api>;
}

/** The thinking level pi will run for the model, without changing the level saved in the agent file. */
export function actualThinking(model: Model<Api>, requested: ModelThinkingLevel): ModelThinkingLevel {
  return clampThinkingLevel(model, requested);
}
