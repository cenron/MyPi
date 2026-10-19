# Sub-agents

**Status:** idea

## Goal

Let the agent hand a task to a sub-agent that runs with its own context window, tools and model, and reports back a
short result. This keeps the main context small, as Claude Code's Task tool and Explore agents do. Build it on
**pi-durable**, so sub-agents survive a crash or restart and can run in the background.

## What pi offers

Pi 1.2.0 has no sub-agent feature built in. There are three ways to run another agent:

| Route | How | Trade-offs |
|---|---|---|
| A child `pi` process | `spawn("pi", ["--mode", "json", "-p", "--no-session", …])`, then read the JSONL events | `examples/extensions/subagent/` does this. Fully isolated, but pi starts up on every run, and the child loads MyPi again. Lost if the parent dies. |
| In process, through the SDK | `createAgentSession({ sessionManager: SessionManager.inMemory() })`, then `session.prompt(task)` | Fast and typed, but you assemble the resource loader, model and tools yourself. Lost if the parent dies. |
| **pi-durable** | `@earendil-works/pi-durable`: a `Harness` over SQLite storage, a child conversation owned by the tool's task | Every turn, tool call and piece of state is committed before it's shown, so a restart resumes where it stopped. Has sub-agents as a built-in pattern, in the foreground and the background. **Experimental:** "The API changes without notice between releases." |

## pi-durable in brief

Checked against `@earendil-works/pi-durable` 1.3.0's README (published 2026-10-15). It isn't installed in MyPi yet.

- **It's a separate harness, not what pi runs on.** It's built on pi-ai, the same model layer pi uses, but pi's coding
  agent still runs its own agent loop. MyPi would run a durable `Harness` *inside* a pi tool, beside pi's session.
- **Pieces:**
  - **Harness:** one open storage (SQLite, JSONL, or in memory) plus the scheduler.
  - **Conversation:** a transcript of immutable entries.
  - **Task:** a state machine saved at every step.
  - **Extension:** tools, prompt sections and hooks, installed in a `Registry`.
  - **Agent:** a conversation's model, tools and `cwd`, set with `configure()`.
- **The sub-agent pattern** (README § "Abort and Subagents"). A `subagent` tool with `replay: "safe"` does this:
  1. Creates a child conversation inside `api.commit()`, owned by its own task:
     `ownership: { kind: "task", taskId: api.taskId }`.
  2. Configures the child, for example with a cheaper model and without the subagent extension, so it can't nest.
  3. Submits the task with a `requestId`, so a rerun after a crash finds the same child and submission instead of
     starting again.
  4. Waits for the answer.
- **Ownership:** aborting the call aborts the child, and the parent is idle only once the child is. A task created with
  `{ background: true }` is a boundary: its children survive the parent's Escape and don't keep it busy.
- **Examples to copy** (in the package's `test/examples/`):
  - `22-subagent-foreground.ts`: the tool above, with the child's events shown under the call.
  - `23-subagent-background.ts`: persistent sub-agents behind one tool that spawns, messages, waits for, stops and
    lists them, with answers posted back to the parent as follow-ups.
  - `28-reviewer.ts`: a reviewer with its own model, tools and directory.
  - `27-plan-mode.ts`: read-only plan mode as an extension.
- **Hooks:** a `ToolTask` hook with `beforeTool(call)` can return `{ block: "…" }`. That's how a child is kept
  read-only.
- **Tools:** `@earendil-works/pi-durable/tools` has its own `read`, `write`, `edit` and `bash` (`CodingTools`), which
  work through an environment (`NodeExecutionEnv({ cwd })`).
- **Watching:** `conversation.viewState()` or `watch()` give a UI the child's live state.

## Behavior

- A `subagent` tool in pi. The first version is foreground: the call waits for the child's answer and returns it.
- Children keep running across a crash or `/reload` and resume from storage.
- Later: background sub-agents, which you start, message, list and stop, with answers posted back to the main session.
- A few agents ship with MyPi: `scout` (read-only, fast model), `reviewer` (read-only), and `worker` (full tools).

## Design in pi

| Piece | Where | Notes |
|---|---|---|
| Tool | `pi.registerTool()` from the module's `init()` | Turns the pi call into a durable submission, streams progress with `onUpdate`, and passes the `signal` through to abort. |
| Harness | Opened in `init()`, closed on `session_shutdown` | SQLite storage, for example under `.pi/` or pi's agent directory, one file per pi session. "One process owns a storage at a time", so two pi windows on one project need separate files. Call `harness.resume()` on open to continue unfinished children. |
| Models | `HarnessOptions.models` takes a pi-ai `Models` | Pi gives extensions `ctx.modelRegistry`, which isn't a `Models`. Either adapt it, or build one with pi-ai's `createModels()` and pi's credentials. **Check this first:** it decides whether children can use the models pi is logged in to. |
| Tools for the child | `CodingTools` with `NodeExecutionEnv({ cwd: ctx.cwd })` | pi-durable's own tools, not pi's. Read-only agents get `read` only, or a `beforeTool` block on `write`, `edit` and `bash`. |
| Agent files | Markdown with frontmatter (`name`, `description`, `tools`, `model`), like pi's example | MyPi's own folder, plus `~/.pi/agent/agents/`. Load project agents (`.pi/agents/`) only in trusted projects. |
| Nesting | The child is configured without the subagent extension | As in the README pattern. |
| Rendering | `renderCall` / `renderResult` in pi, fed from the child's `viewState()` | Show the last few child tool calls and usage; Ctrl+O expands. |

## Plan mode

Plan-build's `tool_call` guard sees only the `subagent` call, never the child's tool calls, which run inside
pi-durable. In Plan, give children read-only tools or a `beforeTool` hook that blocks writes. Otherwise a sub-agent
gets around Plan mode.

## Dependencies

- pi-durable versions follow pi's: 1.2.0 needs `@earendil-works/pi-ai ^1.2.0`, matching the installed pi.
- It brings `@earendil-works/chord`, `@earendil-works/pi-codemode` and Photon (WebAssembly) with it.
- MyPi declares pi's packages as peers so it never ships a second copy. pi-durable depends on pi-ai directly, so check
  that npm dedupes it against pi's copy.
- Node 22.19 or later.

## Slices

1. Install pi-durable, open a Harness in memory, and answer one prompt from a pi command, to prove models and
   credentials work inside pi.
2. Agent file parsing, as a pure function with tests.
3. The `subagent` tool, foreground, on SQLite, with the `requestId` replay pattern.
4. Read-only agents through tools or hooks, plus the plan-mode rule.
5. Rendering from the child's view.
6. Background sub-agents (example 23).

## Open questions

- How do children get models and credentials: adapt `ctx.modelRegistry`, or a separate `createModels()`?
- Where does the SQLite file live, and is it one per pi session or one per project?
- pi-durable is experimental. Pin an exact version?
- Which agents ship with MyPi, and on which models?
- Load type: `ON_LOAD` or `ON_DEMAND`?

## References

- pi-durable: [npm](https://www.npmjs.com/package/@earendil-works/pi-durable), README § "Abort and Subagents",
  "Child Tasks", "Hooks", "Storage", examples 22, 23, 27 and 28, and the
  [spec](https://github.com/earendil-works/pi/blob/main/packages/durable/docs/spec.md)
- pi: `examples/extensions/subagent/`, `docs/sdk.md`, `docs/cli-integration.md`
- Claude Code: [sub-agents](https://code.claude.com/docs/en/sub-agents)
