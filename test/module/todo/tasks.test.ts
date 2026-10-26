import { describe, expect, it } from "vitest";
import {
  createTask,
  listForNewRun,
  rebuildTasks,
  type Task,
  taskReminderDue,
  taskReminderText,
  updateTask,
} from "#module/todo/tasks";

const first: Task = { id: "1", subject: "Run tests", description: "Run the suite", status: "pending" };
const second: Task = { ...first, id: "2", subject: "Write docs", status: "completed" };

describe("createTask", () => {
  it.each([
    ["initial list", [], "1", ["1"]],
    ["continues a list", [first], "2", ["1", "2"]],
    ["continues after every task is completed", [second], "3", ["2", "3"]],
    ["does not reuse an id left by deletion", [first, { ...first, id: "3" }], "4", ["1", "3", "4"]],
  ])("%s", (_label, tasks, id, ids) => {
    const created = createTask(tasks, { subject: "Add files", description: "Three files" });
    expect(created.task.id).toBe(id);
    expect(created.tasks.map((task) => task.id)).toEqual(ids);
  });
});

describe("listForNewRun", () => {
  it.each([
    ["starts over when every task is completed", [second], []],
    ["keeps a list with open tasks", [first, second], [first, second]],
    ["keeps an empty list", [], []],
  ])("%s", (_label, tasks, expected) => {
    expect(listForNewRun(tasks)).toEqual(expected);
  });
});

describe("updateTask", () => {
  it.each([
    ["updates a task", [first], "1", { status: "in_progress" } as const, [{ ...first, status: "in_progress" }]],
    ["deletes a task", [first, second], "1", { status: "deleted" } as const, [second]],
    ["leaves an unknown id unchanged", [first], "8", { status: "completed" } as const, [first]],
  ])("%s", (_label, tasks, id, changes, expected) => {
    expect(updateTask(tasks, id, changes).tasks).toEqual(expected);
  });
});

describe("taskReminderDue", () => {
  const quietAssistant = () => ({ role: "assistant", content: [], timestamp: 0 });
  const taskCall = {
    role: "assistant",
    content: [{ type: "toolCall", id: "task", name: "task_update", arguments: {} }],
    timestamp: 0,
  };

  it.each([
    ["before five quiet assistant messages", Array.from({ length: 4 }, quietAssistant), false],
    ["at five quiet assistant messages", Array.from({ length: 5 }, quietAssistant), true],
    ["at ten quiet assistant messages", Array.from({ length: 10 }, quietAssistant), true],
    [
      "after a task tool call",
      [quietAssistant(), quietAssistant(), taskCall, ...Array.from({ length: 4 }, quietAssistant)],
      false,
    ],
    [
      "when the task tool call is followed by five quiet messages",
      [taskCall, ...Array.from({ length: 5 }, quietAssistant)],
      true,
    ],
  ])("%s", (_label, messages, expected) => {
    expect(taskReminderDue(messages as never[])).toBe(expected);
  });
});

describe("taskReminderText", () => {
  it("is wrapped as a system reminder", () => {
    expect(taskReminderText([])).toMatch(
      /^<system-reminder>\nThe task tools haven't been used recently\..*\n<\/system-reminder>$/s,
    );
  });

  it("includes the current task list when one exists", () => {
    expect(taskReminderText([first, second])).toContain(`Here are the existing tasks:
#1. [pending] Run tests
#2. [completed] Write docs`);
  });
});

describe("rebuildTasks", () => {
  it("uses the last task tool result's complete list", () => {
    const branch = [
      { type: "message", message: { role: "toolResult", toolName: "task_create", details: { tasks: [first] } } },
      { type: "message", message: { role: "toolResult", toolName: "task_update", details: { tasks: [second] } } },
    ];
    expect(rebuildTasks(branch)).toEqual([second]);
  });

  it("ignores unrelated and malformed entries", () => {
    expect(
      rebuildTasks([
        { type: "message", message: { role: "toolResult", toolName: "read", details: { tasks: [first] } } },
        { type: "message", message: { role: "toolResult", toolName: "task_list", details: { tasks: [null] } } },
      ]),
    ).toEqual([]);
  });
});
