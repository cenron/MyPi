import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ask } from "#core/events";
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
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<dim><strike>✔ Run tests"], {
      placement: "aboveEditor",
    });

    await expect(
      toolCall(module, "task_list")?.execute("id", {}, undefined, undefined, fake.session.ctx as ExtensionToolContext),
    ).resolves.toMatchObject({
      content: [{ text: "#1 [completed] Run tests" }],
    });
  });

  it("sets plan-seeding guidance and answers with open tasks", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    const prompt: Record<string, string> = {};
    fake.session.promptManager.apply(prompt);
    expect(prompt["mypi-todo"]).toContain("create one task per deliverable");

    const create = toolCall(module, "task_create");
    await create?.execute(
      "id",
      { subject: "Run tests", description: "Run the suite" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    await toolCall(module, "task_update")?.execute(
      "id",
      { taskId: "1", status: "in_progress" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    await toolCall(module, "task_create")?.execute(
      "id",
      { subject: "Deploy", description: "Deploy it" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    await toolCall(module, "task_update")?.execute(
      "id",
      { taskId: "1", status: "completed" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );

    await expect(ask(fake.session.pi.events, "openTasks", undefined)).resolves.toEqual([
      { kind: "answer", from: "todo", value: [{ id: "2", subject: "Deploy", status: "pending" }] },
    ]);
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

  it("adds a transient reminder at the end of context after five quiet assistant messages", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    const messages = Array.from({ length: 5 }, () => ({ role: "assistant", content: [], timestamp: 0 }));
    const result = await fake.emit("context", { type: "context", messages });

    expect(result).toMatchObject({
      messages: [
        ...messages,
        {
          role: "user",
          content: expect.stringContaining("The task tools haven't been used recently"),
        },
      ],
    });
    expect(messages).toHaveLength(5);
  });

  it("includes the current task list in the transient reminder", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    const create = toolCall(module, "task_create");
    await create?.execute(
      "id",
      { subject: "Run tests", description: "Run the suite" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    const messages = Array.from({ length: 5 }, () => ({ role: "assistant", content: [], timestamp: 0 }));
    const result = (await fake.emit("context", { type: "context", messages })) as {
      messages: { role: string; content: string }[];
    };

    expect(result.messages.at(-1)?.content).toContain("Here are the existing tasks:");
    expect(result.messages.at(-1)?.content).toContain("#1. [pending] Run tests");
  });

  it("does not change context before the reminder is due", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    const messages = Array.from({ length: 4 }, () => ({ role: "assistant", content: [], timestamp: 0 }));

    await expect(fake.emit("context", { type: "context", messages })).resolves.toBeUndefined();
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
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<muted>◻ Read files"], {
      placement: "aboveEditor",
    });
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
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", undefined, {
      placement: "aboveEditor",
    });
  });

  it("draws the checklist and updates the working message after task changes", async () => {
    const fake = fakeSession();
    const module = new TodoModule(fake.session);
    module.init();
    const create = toolCall(module, "task_create");
    const update = toolCall(module, "task_update");

    await create?.execute(
      "id",
      { subject: "Run tests", description: "Run the suite", activeForm: "Running tests" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<muted>◻ Run tests"], {
      placement: "aboveEditor",
    });
    expect(fake.session.ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith(undefined);

    await update?.execute(
      "id",
      { taskId: "1", status: "in_progress" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<accent>◼ Run tests"], {
      placement: "aboveEditor",
    });
    expect(fake.session.ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith("Running tests");

    await update?.execute(
      "id",
      { taskId: "1", status: "completed" },
      undefined,
      undefined,
      fake.session.ctx as ExtensionToolContext,
    );
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<dim><strike>✔ Run tests"], {
      placement: "aboveEditor",
    });
    expect(fake.session.ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith(undefined);
  });

  it("toggles the widget with alt+t", () => {
    const fake = fakeSession([
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "task_create",
          details: { tasks: [{ id: "1", subject: "Run tests", description: "Run tests", status: "pending" }] },
        },
      },
    ]);
    const onKey = vi.spyOn(fake.session.editor, "onKey");
    const module = new TodoModule(fake.session);
    module.init();

    expect(onKey).toHaveBeenCalledWith("alt+t", expect.any(Function));
    const toggle = onKey.mock.calls[0]?.[1];
    expect(toggle).toBeDefined();
    if (!toggle) throw new Error("alt+t handler was not registered");
    toggle();
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", undefined, {
      placement: "aboveEditor",
    });
    toggle();
    expect(fake.session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-todo", ["<muted>◻ Run tests"], {
      placement: "aboveEditor",
    });
  });

  it("does not request UI when it is unavailable", () => {
    const fake = fakeSession();
    fake.session.ctx.hasUI = false;
    const module = new TodoModule(fake.session);
    module.init();
    expect(fake.session.ctx.ui.setWidget).not.toHaveBeenCalled();
    expect(fake.session.ctx.ui.setWorkingMessage).not.toHaveBeenCalled();
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
