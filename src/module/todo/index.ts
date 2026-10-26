import type { ContextEvent, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { listForNewRun, rebuildTasks, type Task, taskReminderDue, taskReminderText } from "./tasks";
import { taskTools } from "./tools";
import { todoWidgetLines } from "./widget";

/** The widget's key, named like MyPi's footer statuses (`mypi-<key>`). */
const WIDGET_KEY = "mypi-todo";

/** Claude Code-style checklist tools whose state follows the active session branch. */
export class TodoModule extends BaseModule {
  private tasks: Task[] = [];
  private widgetVisible = true;

  get info(): ModuleInfo {
    return {
      name: "todo",
      description: "Claude Code-style task list the agent keeps while it works",
      commands: [],
      loadType: ModuleLoadMode.ON_LOAD,
    };
  }

  tools(): ToolDefinition[] {
    return taskTools(
      () => this.tasks,
      (tasks) => {
        this.tasks = tasks;
        this.drawTasks();
      },
    );
  }

  init() {
    this.restoreTasks();
    this.drawTasks();
    this.session.pi.on("session_tree", () => this.onSessionTree());
    this.session.pi.on("context", (ev) => this.onContext(ev));
    // before_agent_start fires once per run, not on the done check's continuations.
    this.session.pi.on("before_agent_start", () => this.onRunStart());
    this.onKey("alt+t", () => this.toggleWidget());
  }

  /** A finished list stays in view until the next prompt, which starts a new one. */
  private onRunStart() {
    this.tasks = listForNewRun(this.tasks);
    this.drawTasks();
  }

  private onSessionTree() {
    this.restoreTasks();
    this.drawTasks();
  }

  private onContext(ev: ContextEvent) {
    if (!taskReminderDue(ev.messages)) return;

    // Transient: returned for this request only, never saved to the session.
    const reminder = {
      role: "user" as const,
      content: taskReminderText(this.tasks),
      timestamp: Date.now(),
    };
    return { messages: [...ev.messages, reminder] };
  }

  private restoreTasks() {
    this.tasks = rebuildTasks(this.session.ctx.sessionManager.getBranch());
  }

  private toggleWidget() {
    this.widgetVisible = !this.widgetVisible;
    this.drawWidget();
  }

  private drawTasks() {
    if (!this.session.ctx.hasUI) return;

    this.drawWidget();
    const activeTask = this.tasks.find((task) => task.status === "in_progress");
    this.session.ctx.ui.setWorkingMessage(activeTask?.activeForm ?? activeTask?.subject);
  }

  private drawWidget() {
    if (!this.session.ctx.hasUI) return;

    const lines = this.widgetVisible ? todoWidgetLines(this.tasks) : [];
    if (lines.length === 0) {
      this.session.ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
      return;
    }

    const content = lines.map(({ text, status }) => {
      if (status === "in_progress") return this.session.ctx.ui.theme.fg("accent", text);
      if (status === "completed") {
        return this.session.ctx.ui.theme.fg("dim", this.session.ctx.ui.theme.strikethrough(text));
      }
      if (status === "pending") return this.session.ctx.ui.theme.fg("muted", text);
      return this.session.ctx.ui.theme.fg("dim", text);
    });
    this.session.ctx.ui.setWidget(WIDGET_KEY, content, { placement: "aboveEditor" });
  }
}
