import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { TodoModule } from "#module/todo/index";
import { fakeSession } from "../../fakes";

function toolCall(module: TodoModule, name: string) {
  return module.tools().find((tool) => tool.name === name);
}

describe("TodoModule", () => {
  it("registers the four tools and restores task state from the active branch", async () => {
    const branch: unknown[] = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "task_create",
          details: { tasks: [{ id: "1", subject: "Run tests", description: "Run tests", status: "completed" }] },
        },
      },
    ];
    const fake = fakeSession(branch);
    const module = new TodoModule(fake.session);
    expect(module.info.loadType).toBe("on_load");
    expect(module.tools().map((tool) => tool.name)).toEqual(["task_create", "task_update", "task_list", "task_get"]);
    module.init();

    await expect(
      toolCall(module, "task_list")?.execute("id", {}, undefined, undefined, fake.session.ctx as ExtensionToolContext),
    ).resolves.toMatchObject({
      content: [{ text: "#1 [completed] Run tests" }],
    });
  });

  it("includes task-use guidance in the tool descriptions", () => {
    const descriptions = new Map(
      new TodoModule(fakeSession().session).tools().map((tool) => [tool.name, tool.description]),
    );
    expect(descriptions.get("task_create")).toContain("When a task requires 3 or more distinct steps or actions");
    expect(descriptions.get("task_update")).toContain("Never mark a task as completed if:");
    expect(descriptions.get("task_list")).toContain("Prefer working on tasks in ID order");
    expect(descriptions.get("task_get")).toContain("full description and context before starting work");
  });

  it("updates the list and puts the full state in each result", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    const create = toolCall(module, "task_create");
    const created = await create?.execute(
      "id",
      { subject: "Run tests", description: "Run the suite", activeForm: "Running tests" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    expect(created).toMatchObject({
      content: [{ text: "Task #1 created successfully: Run tests" }],
      details: { tasks: [{ id: "1", status: "pending" }] },
    });

    const updated = await toolCall(module, "task_update")?.execute(
      "id",
      { taskId: "1", status: "in_progress" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    expect(updated).toMatchObject({
      content: [{ text: "Updated task #1 status" }],
      details: { tasks: [{ id: "1", status: "in_progress" }] },
    });
    await expect(
      toolCall(module, "task_get")?.execute(
        "id",
        { taskId: "1" },
        undefined,
        undefined,
        fake.session.ctx as ExtensionToolContext,
      ),
    ).resolves.toMatchObject({ content: [{ text: "#1 [in_progress] Run tests\nRun the suite" }] });

    await expect(
      toolCall(module, "task_update")?.execute(
        "id",
        { taskId: "1", subject: "Run the full test suite" },
        undefined,
        undefined,
        fake.session.ctx as ExtensionToolContext,
      ),
    ).resolves.toMatchObject({
      content: [{ text: "Updated task #1" }],
      details: { tasks: [{ subject: "Run the full test suite", description: "Run the suite", status: "in_progress" }] },
    });
  });

  it("restores state again after session tree navigation", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    fake.branch.push({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "task_create",
        details: { tasks: [{ id: "1", subject: "Read files", description: "Read files", status: "pending" }] },
      },
    });
    await fake.emit("session_tree", { type: "session_tree" });
    await expect(
      toolCall(module, "task_list")?.execute("id", {}, undefined, undefined, fake.session.ctx as ExtensionToolContext),
    ).resolves.toMatchObject({ content: [{ text: "#1 [pending] Read files" }] });
  });

  it("starts a new list when a run starts with every task completed", async () => {
    const fake = fakeSession();
    fake.branch.push({
      type: "message",
      message: {
        role: "toolResult",
        toolName: "task_update",
        details: { tasks: [{ id: "1", subject: "Read files", description: "Read files", status: "completed" }] },
      },
    });
    const module = new TodoModule(fake.session);
    module.init();
    await fake.emit("before_agent_start", { type: "before_agent_start" });
    await expect(
      toolCall(module, "task_list")?.execute("id", {}, undefined, undefined, fake.session.ctx as ExtensionToolContext),
    ).resolves.toMatchObject({ content: [{ text: "No tasks." }] });
  });

  it("reports an unknown task with the recovery tool", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    const get = toolCall(module, "task_get");
    await expect(
      get?.execute("id", { taskId: "7" }, undefined, undefined, fake.session.ctx as ExtensionToolContext),
    ).rejects.toThrow("Task #7 not found; use task_list");
  });
});
