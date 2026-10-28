import type { Task, TaskStatus } from "./tasks";

const MAX_WIDGET_LINES = 5;
const MAX_TASK_LINES_WITH_MORE = MAX_WIDGET_LINES - 1;

/** Claude Code's marks. */
const MARKS: Record<TaskStatus, string> = { in_progress: "◼", pending: "◻", completed: "✔" };

/** Which tasks keep a row when not all fit: in progress, then pending, then the latest completed. */
const PRIORITY: Record<TaskStatus, number> = { in_progress: 0, pending: 1, completed: 2 };

/** One widget row; the status lets the module apply pi's current theme. */
type TodoWidgetLine = { text: string; status?: Task["status"] };

/**
 * The checklist above the editor: every task in id order when five fit; otherwise four rows picked in progress first,
 * then pending, then the latest completed, and a last row counting the rest.
 */
export function todoWidgetLines(tasks: readonly Task[]): TodoWidgetLine[] {
  if (tasks.length === 0) return [];

  const rows = tasks.length > MAX_WIDGET_LINES ? MAX_TASK_LINES_WITH_MORE : MAX_WIDGET_LINES;
  const visible = tasks.toSorted(byPriority).slice(0, rows).toSorted(byId);
  const lines: TodoWidgetLine[] = visible.map((task) => ({
    text: `${MARKS[task.status]} ${task.subject}`,
    status: task.status,
  }));

  const omitted = tasks.filter((task) => !visible.includes(task));
  if (omitted.length > 0) {
    const completedOmitted = omitted.filter((task) => task.status === "completed").length;
    lines.push({ text: `… +${omitted.length} more (${completedOmitted} completed)` });
  }
  return lines;
}

function byId(left: Task, right: Task): number {
  return Number(left.id) - Number(right.id);
}

/** Completed tasks latest first, the others lowest id first. */
function byPriority(left: Task, right: Task): number {
  const rank = PRIORITY[left.status] - PRIORITY[right.status];
  if (rank !== 0) return rank;
  return left.status === "completed" ? byId(right, left) : byId(left, right);
}
