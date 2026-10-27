import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { isRecord } from "#core/util/guards";
import { TASK_TOOLS } from "#core/util/task-tools";

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

const TASK_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(TASK_TOOLS));
/** Quiet model requests between reminders; Claude Code doesn't publish its own count. */
const REMINDER_INTERVAL = 5;
/** Claude Code's reminder, with MyPi's tool names. */
const REMINDER_TEXT =
  "The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using task_create to add new tasks and task_update to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable.";

/** Adds one pending task with the next id. */
export function createTask(tasks: Task[], input: Omit<Task, "id" | "status">): { tasks: Task[]; task: Task } {
  const nextId = tasks.reduce((highest, task) => Math.max(highest, Number(task.id)), 0) + 1;
  const task: Task = { ...input, id: String(nextId), status: "pending" };
  return { tasks: [...tasks, task], task };
}

/**
 * The list with a finished one cleared: empty once every task is completed, so the widget goes away and the next task
 * starts over at id 1. Applied when a run settles and when a list is restored, never mid-run: the model often creates
 * one task, finishes it, then creates the next, and that must not wipe the list.
 */
export function clearedIfFinished(tasks: Task[]): Task[] {
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

/** True on every fifth assistant message since the last task tool call (or since the start). */
export function taskReminderDue(messages: readonly ContextEvent["messages"][number][]): boolean {
  let quietMessages = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    if (message.content.some((block) => block.type === "toolCall" && TASK_TOOL_NAMES.has(block.name))) {
      quietMessages = 0;
      continue;
    }
    quietMessages++;
  }
  return quietMessages > 0 && quietMessages % REMINDER_INTERVAL === 0;
}

/**
 * The reminder sent with the next model request, and the list when there is one. In `<system-reminder>` tags, as
 * Claude Code sends it, so the model doesn't take it for the user's words.
 */
export function taskReminderText(tasks: readonly Task[]): string {
  const list = tasks.map((task) => `#${task.id}. [${task.status}] ${task.subject}`).join("\n");
  const text = tasks.length === 0 ? REMINDER_TEXT : `${REMINDER_TEXT}\n\nHere are the existing tasks:\n${list}`;
  return `<system-reminder>\n${text}\n</system-reminder>`;
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
