import { isRecord } from "#core/util/guards";

/** The statuses task_update can set on a task (deleted removes it). */
export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;

/** A task's live status; deletion is an update action, not a retained status. */
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** One item in the branch-following task list. */
export type Task = {
  id: string;
  subject: string;
  description: string;
  activeForm?: string;
  status: TaskStatus;
};

type TaskChanges = Partial<Pick<Task, "subject" | "description" | "activeForm">> & {
  status?: TaskStatus | "deleted";
};

/** The task tool names shared by their definitions and branch-state reconstruction. */
export const TASK_TOOLS = {
  create: "task_create",
  update: "task_update",
  list: "task_list",
  get: "task_get",
} as const;

const TASK_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(TASK_TOOLS));

/** Adds one pending task with the next id. */
export function createTask(tasks: Task[], input: Omit<Task, "id" | "status">): { tasks: Task[]; task: Task } {
  const nextId = tasks.reduce((highest, task) => Math.max(highest, Number(task.id)), 0) + 1;
  const task: Task = { ...input, id: String(nextId), status: "pending" };
  return { tasks: [...tasks, task], task };
}

/**
 * The list a new run starts with: empty once every task is completed, so the next one starts over at id 1. Only at a
 * run's start: the model often creates one task, finishes it, then creates the next, and that must not wipe the list.
 */
export function listForNewRun(tasks: Task[]): Task[] {
  return tasks.length > 0 && tasks.every((task) => task.status === "completed") ? [] : tasks;
}

/** Updates one task or removes it when status is `deleted`. */
export function updateTask(tasks: Task[], id: string, changes: TaskChanges): { tasks: Task[]; task: Task | undefined } {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return { tasks, task: undefined };
  const { status, ...details } = changes;
  if (status === "deleted") return { tasks: tasks.filter((candidate) => candidate.id !== id), task };

  const updated = { ...task, ...details, ...(status === undefined ? {} : { status }) };
  return { tasks: tasks.map((candidate) => (candidate.id === id ? updated : candidate)), task: updated };
}

/** Restores the latest valid todo tool result on the active session branch. */
export function rebuildTasks(branch: readonly unknown[]): Task[] {
  let tasks: Task[] = [];
  for (const entry of branch) {
    tasks = tasksIn(entry) ?? tasks;
  }
  return tasks;
}

function tasksIn(entry: unknown): Task[] | undefined {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return undefined;
  const message = entry.message;
  if (message.role !== "toolResult" || typeof message.toolName !== "string" || !TASK_TOOL_NAMES.has(message.toolName)) {
    return undefined;
  }
  if (!isRecord(message.details) || !Array.isArray(message.details.tasks) || !message.details.tasks.every(isTask)) {
    return undefined;
  }
  return message.details.tasks;
}

function isTask(value: unknown): value is Task {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.subject === "string" &&
    typeof value.description === "string" &&
    (value.activeForm === undefined || typeof value.activeForm === "string") &&
    TASK_STATUSES.some((status) => status === value.status)
  );
}
