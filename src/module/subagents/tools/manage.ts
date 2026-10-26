import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { defineTool, type ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { Session } from "#core/session";
import type { ToolRule } from "#core/tool-guard";
import {
  type AgentAccess,
  type AgentDefinition,
  checkAgent,
  deleteAgent,
  projectAgentDir,
  saveAgent,
  THINKING_SETTINGS,
  type ThinkingSetting,
  userAgentDir,
  validateAgentName,
} from "../agents";
import { actualThinking, resolveAgentModel } from "../manage-model";

const parameters = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("edit"), Type.Literal("delete")]),
  name: Type.String({ description: "Lowercase letters, digits, and hyphens." }),
  description: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  access: Type.Optional(Type.Union([Type.Literal("read-only"), Type.Literal("write")])),
  tools: Type.Optional(Type.Array(Type.String())),
  model: Type.Optional(
    Type.String({ description: "A model name such as `luna 6`, an exact `provider/id`, or `inherit`." }),
  ),
  thinking: Type.Optional(
    Type.Union(
      THINKING_SETTINGS.map((level) => Type.Literal(level)),
      { description: "A thinking level for this agent." },
    ),
  ),
  scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")])),
});

type ManageArgs = Static<typeof parameters>;
type AgentData = Omit<AgentDefinition, "source" | "path">;
type ManageCallbacks = {
  agents: () => AgentDefinition[];
  runtime: () => Promise<ModelRuntime>;
  runtimeReady: () => ModelRuntime | undefined;
  trusted: () => boolean;
  currentModel: () => Model<Api> | undefined;
  currentThinking: () => ModelThinkingLevel;
  builtinNames: () => readonly string[];
  reload: () => void;
};
type ChangeContext = {
  agents: AgentDefinition[];
  builtinNames: readonly string[];
  cwd: string;
  runtime?: ModelRuntime;
  trusted: boolean;
  currentModel: Model<Api> | undefined;
  currentThinking: ModelThinkingLevel;
};
type PlannedChange =
  | { kind: "delete"; agent: AgentDefinition; builtinReturns: boolean }
  | {
      kind: "save";
      action: "create" | "edit";
      data: AgentData;
      folder: string;
      model: Model<Api> | undefined;
      thinking: ModelThinkingLevel;
    };

/** Creates and changes definitions in the user or trusted project folder. */
export function agentManageTool(session: Session, callbacks: ManageCallbacks): ToolDefinition {
  return defineTool({
    name: "agent_manage",
    label: "Manage agent",
    description: "Create, edit, or delete a subagent definition. Every change asks for your approval.",
    promptSnippet: "Create, change, or remove an agent definition",
    exposure: "deferred",
    parameters,
    async execute(_id, args, _signal, _onUpdate, _ctx) {
      const plan = planAgentChange(args, {
        agents: callbacks.agents(),
        builtinNames: callbacks.builtinNames(),
        cwd: session.ctx.cwd,
        runtime: args.action === "delete" ? undefined : await callbacks.runtime(),
        trusted: callbacks.trusted(),
        currentModel: callbacks.currentModel(),
        currentThinking: callbacks.currentThinking(),
      });
      if (plan.kind === "delete") {
        deleteAgent(plan.agent);
        callbacks.reload();
        return {
          content: [
            {
              type: "text",
              text: `Deleted ${plan.agent.source} agent '${plan.agent.name}'.${plan.builtinReturns ? " The builtin will return." : ""}`,
            },
          ],
          details: {},
        };
      }

      const path = saveAgent(plan.data, plan.folder);
      callbacks.reload();
      return {
        content: [
          {
            type: "text",
            text: `Saved ${path}. Model: ${plan.data.model}; thinking: ${plan.thinking} (requested ${plan.data.thinking}).`,
          },
        ],
        details: {},
      };
    },
  });
}

/** Requires approval for every change and shows the exact planned change. */
export function agentManageRule(callbacks: ManageCallbacks, cwd: string): ToolRule {
  return (call) => {
    if (call.toolName !== "agent_manage") return { kind: "allow" };
    try {
      const args = call.input as unknown as ManageArgs;
      const plan = planAgentChange(args, {
        agents: callbacks.agents(),
        builtinNames: callbacks.builtinNames(),
        cwd,
        runtime: callbacks.runtimeReady(),
        trusted: callbacks.trusted(),
        currentModel: callbacks.currentModel(),
        currentThinking: callbacks.currentThinking(),
      });
      if (plan.kind === "delete") return confirmDelete(plan);
      return confirmSave(plan);
    } catch (error) {
      return { kind: "block", reason: error instanceof Error ? error.message : String(error) };
    }
  };
}

function planAgentChange(args: ManageArgs, context: ChangeContext): PlannedChange {
  validateAgentName(args.name);
  const current = context.agents.find((agent) => agent.name === args.name);
  if (args.action === "delete") {
    if (!current) throw new Error(`No agent named '${args.name}'.`);
    if (current.source === "builtin") throw new Error(`Built-in agent '${current.name}' can't be deleted.`);
    return {
      kind: "delete",
      agent: current,
      builtinReturns: current.source === "user" && context.builtinNames.includes(current.name),
    };
  }

  const data = agentData(args, context.agents);
  const scope = args.scope ?? (current?.source === "project" ? "project" : "user");
  if (scope === "project" && !context.trusted) {
    throw new Error("Project agents are refused in an untrusted project.");
  }

  const model =
    data.model === "inherit" ? context.currentModel : resolveAgentModel(requireRuntime(context.runtime), data.model);
  if (data.model !== "inherit" && model) data.model = `${model.provider}/${model.id}`;
  const requestedThinking = data.thinking === "inherit" ? context.currentThinking : data.thinking;
  const thinking = model ? actualThinking(model, requestedThinking) : requestedThinking;
  checkAgent(data);
  return {
    kind: "save",
    action: args.action,
    data,
    folder: scope === "project" ? projectAgentDir(context.cwd) : userAgentDir(),
    model,
    thinking,
  };
}

function confirmDelete(plan: Extract<PlannedChange, { kind: "delete" }>) {
  return {
    kind: "ask" as const,
    questions: [
      `Delete ${plan.agent.source} agent '${plan.agent.name}' at ${plan.agent.path}.${plan.builtinReturns ? " The builtin will return." : ""}`,
    ],
  };
}

function confirmSave(plan: Extract<PlannedChange, { kind: "save" }>) {
  const currentModel = plan.model ? `${plan.model.provider}/${plan.model.id}` : undefined;
  const modelName =
    plan.data.model === "inherit" ? `inherit${currentModel ? ` (current: ${currentModel})` : ""}` : currentModel;
  const promptStart = plan.data.prompt.split("\n").slice(0, 3).join("\n");
  return {
    kind: "ask" as const,
    questions: [
      [
        `Save ${plan.action} agent '${plan.data.name}' to ${plan.folder}`,
        `description: ${plan.data.description}`,
        `access: ${plan.data.access}`,
        `tools: ${plan.data.tools?.join(", ") ?? "default"}`,
        `model: ${modelName}`,
        `thinking: ${plan.thinking} (requested ${plan.data.thinking})`,
        `prompt: ${promptStart}`,
      ].join("\n"),
    ],
  };
}

function agentData(args: ManageArgs, agents: AgentDefinition[]): AgentData {
  const current = agents.find((agent) => agent.name === args.name);
  if (args.action === "create" && current) throw new Error(`Agent '${args.name}' already exists; use action 'edit'.`);
  if (args.action === "edit" && !current) throw new Error(`No agent named '${args.name}' to edit.`);
  const description = args.description ?? current?.description ?? "";
  const prompt = args.prompt ?? current?.prompt ?? "";
  if (!description.trim()) throw new Error("Provide a description when creating or editing an agent.");
  if (args.action === "create" && !prompt.trim()) throw new Error("Provide a prompt when creating an agent.");
  return {
    name: args.name,
    description,
    access: (args.access ?? current?.access ?? "read-only") as AgentAccess,
    ...(args.tools === undefined
      ? current?.tools === undefined
        ? {}
        : { tools: current.tools }
      : { tools: args.tools }),
    model: args.model ?? current?.model ?? "inherit",
    thinking: (args.thinking ?? current?.thinking ?? "inherit") as ThinkingSetting,
    prompt,
  };
}

function requireRuntime(runtime: ModelRuntime | undefined): ModelRuntime {
  if (!runtime) throw new Error("The model list is still loading; retry agent_manage.");
  return runtime;
}
