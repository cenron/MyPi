import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";
import { BaseModule } from "../base";
import { listForNewRun, rebuildTasks, type Task } from "./tasks";
import { taskTools } from "./tools";

/** Claude Code-style checklist tools whose state follows the active session branch. */
export class TodoModule extends BaseModule {
  private tasks: Task[] = [];

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
      },
    );
  }

  init() {
    this.restoreTasks();
    this.session.pi.on("session_tree", () => this.restoreTasks());
    // before_agent_start fires once per run, not on the done check's continuations.
    this.session.pi.on("before_agent_start", () => this.onRunStart());
  }

  /** A finished list stays in view until the next prompt, which starts a new one. */
  private onRunStart() {
    this.tasks = listForNewRun(this.tasks);
  }

  private restoreTasks() {
    this.tasks = rebuildTasks(this.session.ctx.sessionManager.getBranch());
  }
}
