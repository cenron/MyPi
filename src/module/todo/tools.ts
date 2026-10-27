import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { TASK_TOOLS } from "#core/util/task-tools";
import { createTask, TASK_STATUSES, type Task, updateTask } from "./tasks";

const TASK_UPDATE_STATUSES = [...TASK_STATUSES, "deleted"] as const;

const createParameters = Type.Object({
  subject: Type.String({ description: "A brief title for the task" }),
  description: Type.String({ description: "What needs to be done" }),
  activeForm: Type.Optional(
    Type.String({ description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")' }),
  ),
});

const updateParameters = Type.Object({
  taskId: Type.String({ description: "The ID of the task to update" }),
  status: Type.Optional(StringEnum(TASK_UPDATE_STATUSES, { description: "New status for the task" })),
  subject: Type.Optional(Type.String({ description: "A brief title for the task" })),
  description: Type.Optional(Type.String({ description: "What needs to be done" })),
  activeForm: Type.Optional(
    Type.String({ description: 'Present continuous form shown in spinner when in_progress (e.g., "Running tests")' }),
  ),
});

const taskIdParameters = Type.Object({ taskId: Type.String({ description: "The ID of the task to retrieve" }) });

type CreateArgs = Static<typeof createParameters>;
type UpdateArgs = Static<typeof updateParameters>;

/** Builds the four task tools over the module's branch-restored list. */
export function taskTools(getTasks: () => Task[], setTasks: (tasks: Task[]) => void) {
  const create = defineTool({
    name: TASK_TOOLS.create,
    label: "Task create",
    description: `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done
- **activeForm** (optional): Present continuous form shown in the spinner when the task is in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the subject instead.

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Check task_list first to avoid creating duplicate tasks`,
    promptSnippet: "Create one task in the progress checklist",
    annotations: { readOnlyHint: true },
    parameters: createParameters,
    async execute(_id, args: CreateArgs) {
      const { tasks, task } = createTask(getTasks(), args);
      setTasks(tasks);
      return result(`Task #${task.id} created successfully: ${task.subject}`, tasks);
    },
  });

  const update = defineTool({
    name: TASK_TOOLS.update,
    label: "Task update",
    description: `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your tasks as resolved when you finish them
- After resolving, call task_list to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep it as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer

## Fields You Can Update

- **status**: New status for the task (see Status Workflow below)
- **subject**: A brief title for the task (imperative form, e.g., "Run tests")
- **description**: What needs to be done
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Examples

Mark task as in progress when starting work:
{"taskId": "1", "status": "in_progress"}

Mark task as completed after finishing work:
{"taskId": "1", "status": "completed"}

Delete a task:
{"taskId": "1", "status": "deleted"}`,
    promptSnippet: "Update one task's status or details",
    annotations: { readOnlyHint: true },
    parameters: updateParameters,
    async execute(_id, args: UpdateArgs) {
      const { taskId, ...changes } = args;
      const { tasks, task } = updateTask(getTasks(), taskId, changes);
      if (!task) throw unknownTask(taskId);
      setTasks(tasks);
      const text =
        args.status === "deleted"
          ? `Deleted task #${task.id}`
          : args.status
            ? `Updated task #${task.id} status`
            : `Updated task #${task.id}`;
      return result(text, tasks);
    },
  });

  const list = defineTool({
    name: TASK_TOOLS.list,
    label: "Task list",
    description: `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending')
- To check overall progress on the project
- After completing a task, to find the next one
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with task_get, task_update)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'

Use task_get with a specific task ID to view full details including description.`,
    promptSnippet: "List all tasks in the progress checklist",
    annotations: { readOnlyHint: true },
    parameters: Type.Object({}),
    async execute() {
      const tasks = getTasks();
      const text = tasks.length
        ? tasks.map((task) => `#${task.id} [${task.status}] ${task.subject}`).join("\n")
        : "No tasks.";
      return result(text, tasks);
    },
  });

  const get = defineTool({
    name: TASK_TOOLS.get,
    label: "Task get",
    description: `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'

## Tips

- Use task_list to see all tasks in summary form.`,
    promptSnippet: "Get one task and its full description",
    annotations: { readOnlyHint: true },
    parameters: taskIdParameters,
    async execute(_id, { taskId }: { taskId: string }) {
      const tasks = getTasks();
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) throw unknownTask(taskId);
      return result(`#${task.id} [${task.status}] ${task.subject}\n${task.description}`, tasks);
    },
  });

  return [create, update, list, get];
}

function result(text: string, tasks: Task[]) {
  return { content: [{ type: "text" as const, text }], details: { tasks } };
}

function unknownTask(id: string): Error {
  return new Error(`Task #${id} not found; use task_list to see available tasks.`);
}
