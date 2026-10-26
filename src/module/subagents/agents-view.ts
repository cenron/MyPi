import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  SelectList,
  type SelectListTheme,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Command } from "#core/types";
import { errorMessage } from "#core/util/errors";
import { DIALOG_LIST_ROWS, Dialog } from "#ui/components/dialog";
import {
  type AgentDefinition,
  deleteAgent,
  parseAgentFile,
  projectAgentDir,
  saveAgent,
  serializeAgent,
} from "./agents";
import { childTools } from "./child";

type AgentAction =
  | { kind: "edit"; agent: AgentDefinition }
  | { kind: "new" }
  | { kind: "delete"; agent: AgentDefinition };

type AgentViewCallbacks = {
  agents: () => AgentDefinition[];
  cwd: () => string;
  userDir: () => string;
  reload: () => void;
};

/** Opens the agent definitions menu. */
export function agentsCmd(callbacks: AgentViewCallbacks): Command {
  return {
    info: { name: "agents", description: "View, create, edit, or delete agents" },
    async execute(ctx) {
      if (ctx.mode !== "tui") throw new Error("/agents requires TUI mode");
      let message: string | undefined;
      let focus: string | undefined;
      while (true) {
        const action = await ctx.ui.custom<AgentAction | undefined>(
          (tui, theme, _keybindings, done) => {
            const dialog = new Dialog(theme, { title: "Agents" });
            dialog.addChild(new AgentsView(theme, tui, done, callbacks, message, focus));
            return dialog;
          },
          { overlay: true, overlayOptions: { anchor: "center", width: 110, maxHeight: "80%" } },
        );
        if (!action) return;
        focus = action.kind === "new" ? undefined : action.agent.name;
        message = await runAction(action, ctx, callbacks);
      }
    },
  };
}

async function runAction(
  action: AgentAction,
  ctx: ExtensionCommandContext,
  callbacks: AgentViewCallbacks,
): Promise<string | undefined> {
  if (action.kind === "edit") {
    const text = await ctx.ui.editor(`Edit ${action.agent.name}`, serializeAgent(action.agent));
    if (text === undefined) return undefined;
    return saveText(text, agentFolder(action.agent, callbacks), action.agent, callbacks);
  }
  if (action.kind === "new") {
    const template = serializeAgent({
      name: "new-agent",
      description: "When to use this agent",
      access: "read-only",
      model: "inherit",
      thinking: "inherit",
      prompt: "Describe the agent's role and how it should report its work.",
    });
    const text = await ctx.ui.editor("New agent", template);
    if (text === undefined) return undefined;
    return saveText(text, callbacks.userDir(), undefined, callbacks);
  }
  if (action.agent.source === "builtin") return `Built-in agent '${action.agent.name}' can't be deleted.`;
  if (!(await ctx.ui.confirm(`Delete ${action.agent.name}?`, `Delete ${action.agent.path}?`))) return undefined;
  deleteAgent(action.agent);
  callbacks.reload();
  return "Agent definitions reloaded.";
}

class AgentsView implements Component {
  private selected: AgentDefinition | undefined;
  private agents: AgentDefinition[];
  private readonly list: SelectList;

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly done: (result: AgentAction | undefined) => void,
    callbacks: AgentViewCallbacks,
    private readonly message: string | undefined,
    focus: string | undefined,
  ) {
    this.agents = callbacks.agents();
    const listTheme: SelectListTheme = {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("dim", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("dim", text),
    };
    const rows = this.agents.map((agent) => ({
      value: agent.name,
      label: `${agent.name} · ${agent.source} · ${agent.model} · ${agent.thinking} · ${agent.access}`,
    }));
    this.list = new SelectList(rows, DIALOG_LIST_ROWS, listTheme);
    // Reopened after an edit or delete: stay on the row the user was on.
    this.list.setSelectedIndex(
      Math.max(
        0,
        rows.findIndex((row) => row.value === focus),
      ),
    );
    this.list.onSelect = (item) => {
      this.selected = this.agents.find((agent) => agent.name === item.value);
      this.tui.requestRender();
    };
    this.list.onCancel = () => this.done(undefined);
  }

  render(width: number): string[] {
    if (this.selected) {
      return [...formatAgent(this.selected), "", this.theme.fg("dim", "Esc back")].map((line) =>
        truncateToWidth(line, width, "…"),
      );
    }
    return [
      ...this.list.render(width),
      this.theme.fg("dim", "Enter details · e edit · n new · d delete · Esc close"),
      ...(this.message ? [this.message] : []),
    ];
  }

  invalidate() {
    this.list.invalidate();
  }

  handleInput(key: string) {
    if (this.selected) {
      if (matchesKey(key, "escape")) {
        this.selected = undefined;
        this.tui.requestRender();
      }
      return;
    }
    if (matchesKey(key, "escape")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(key, "e")) {
      const agent = this.selectedAgent();
      if (agent) this.done({ kind: "edit", agent });
      return;
    }
    if (matchesKey(key, "n")) {
      this.done({ kind: "new" });
      return;
    }
    if (matchesKey(key, "d")) {
      const agent = this.selectedAgent();
      if (agent) this.done({ kind: "delete", agent });
      return;
    }
    this.list.handleInput(key);
  }

  private selectedAgent(): AgentDefinition | undefined {
    return this.agents.find((agent) => agent.name === this.list.getSelectedItem()?.value);
  }
}

function saveText(
  text: string,
  folder: string,
  edited: AgentDefinition | undefined,
  callbacks: AgentViewCallbacks,
): string {
  try {
    const agent = parseAgentFile("agent.md", text);
    const conflict = callbacks
      .agents()
      .find((existing) => existing.name === agent.name && existing.name !== edited?.name);
    if (!edited && conflict) throw new Error(`Agent '${agent.name}' already exists; edit it instead.`);
    if (edited && conflict) throw new Error(`Agent '${agent.name}' already exists; choose another name.`);
    saveAgent(agent, folder);
    if (edited && edited.name !== agent.name && edited.source !== "builtin") deleteAgent(edited);
    callbacks.reload();
    return "Agent definitions reloaded.";
  } catch (error) {
    return errorMessage(error);
  }
}

function agentFolder(agent: AgentDefinition, callbacks: AgentViewCallbacks): string {
  return agent.source === "project" ? projectAgentDir(callbacks.cwd()) : callbacks.userDir();
}

function formatAgent(agent: AgentDefinition): string[] {
  const tools = childTools(agent);
  return [
    `Name: ${agent.name}`,
    `Source: ${agent.source}`,
    `Path: ${agent.path}`,
    `Description: ${agent.description}`,
    `Access: ${agent.access}`,
    `Tools: ${tools?.join(", ") ?? "pi's default tools"}`,
    `Model: ${agent.model}`,
    `Thinking: ${agent.thinking}`,
    "",
    agent.prompt,
  ];
}
