import { describe, expect, it } from "vitest";
import type { Task, TaskStatus } from "#module/todo/tasks";
import { todoWidgetLines } from "#module/todo/widget";

function task(id: number, status: TaskStatus, subject = `Task ${id}`): Task {
  return { id: String(id), subject, description: subject, status };
}

describe("todoWidgetLines", () => {
  it("shows every task in id order when five fit", () => {
    expect(
      todoWidgetLines([
        task(3, "completed"),
        task(2, "pending"),
        task(4, "in_progress"),
        task(1, "completed"),
        task(5, "pending"),
      ]),
    ).toEqual([
      { text: "✔ Task 1", status: "completed" },
      { text: "◻ Task 2", status: "pending" },
      { text: "✔ Task 3", status: "completed" },
      { text: "◼ Task 4", status: "in_progress" },
      { text: "◻ Task 5", status: "pending" },
    ]);
  });

  it("keeps the latest completed task before older ones when rows run short", () => {
    expect(
      todoWidgetLines([
        task(1, "completed"),
        task(2, "completed"),
        task(3, "completed"),
        task(4, "in_progress"),
        task(5, "pending"),
        task(6, "pending"),
      ]),
    ).toEqual([
      { text: "✔ Task 3", status: "completed" },
      { text: "◼ Task 4", status: "in_progress" },
      { text: "◻ Task 5", status: "pending" },
      { text: "◻ Task 6", status: "pending" },
      { text: "… +2 more (2 completed)" },
    ]);
  });

  it("reserves the fifth row for a summary when tasks are left out", () => {
    expect(
      todoWidgetLines([
        task(1, "in_progress"),
        task(2, "pending"),
        task(3, "pending"),
        task(4, "pending"),
        task(5, "pending"),
        task(6, "completed"),
        task(7, "completed"),
      ]),
    ).toEqual([
      { text: "◼ Task 1", status: "in_progress" },
      { text: "◻ Task 2", status: "pending" },
      { text: "◻ Task 3", status: "pending" },
      { text: "◻ Task 4", status: "pending" },
      { text: "… +3 more (2 completed)" },
    ]);
  });

  it("has no rows for an empty task list", () => {
    expect(todoWidgetLines([])).toEqual([]);
  });
});
