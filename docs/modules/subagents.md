# Sub-agents

**Status:** planned (design agreed 2026-10-23; #6 on the [roadmap](../roadmap.md), after worktree; milestone 1 first)

**Load type:** `ON_LOAD`. On by default, so the agent can use the `subagent` tool whenever the module is loaded; the user
can turn it off in `/modules`.

## Goal

Let the agent hand a task to a sub-agent that runs with its own context window, tools, model and effort, and reports
back. This keeps the main context small, lets a second model check the work, and lets each kind of job go to the
model that suits it.

Agents are set up once per responsibility (an architect, a developer, a reviewer), each with its own model and effort,
and reused. I add more by asking ("create me a tester sub-agent that writes tests from the spec, using luna 6") or in
the fleet view, which also shows what's running.

## Where the ideas come from

- **[pi-subagents](../inspiration/pi-subagents.md):** children through pi's own SDK, agents as Markdown, read-only
  roles, no nesting, evidence in the result, and a fleet view.
- **[Radian](https://github.com/cenron/radian-harness)**, my own earlier harness: other harnesses as interactive
  sessions in herdr panes, on my subscriptions. That's the [external agents](#external-agents-later) part, deferred.
- **Claude Code:** the Task tool, Explore agents, and agent files with a tool allowlist.

## Decisions (2026-10-23)

1. **Internal and external.** An internal agent is pi itself: a pi session made with pi's SDK inside pi's process.
   An external agent is another harness (Claude Code, Codex, …) started in its interactive mode in a herdr pane and
   managed through herdr. Pi is always internal. No headless `claude -p` or `codex exec`. **External agents are
   deferred:** internal first.
2. **Definitions, not one-off agents.** An agent is a reusable definition for a responsibility; a run is that agent
   doing one task. MyPi ships `architect`, `developer`, and `reviewer`. I add agents by asking the model or in the
   fleet view.
3. **Creating, editing and deleting always ask me**, with the whole definition shown. Saved globally by default.
   Allowed in Plan mode; running a `write` agent isn't. Builtins can't be deleted, only overridden by my own copy.
4. **Models and effort:** a loose name ("luna 6") is resolved once, at creation, to an exact `provider/id`; if it
   matches several models, the model asks me. The level actually used is shown when pi lowers it. A missing model
   fails clearly. `inherit` (the main session's model) is a deliberate choice, and the builtins ship with it.
5. **Tools:** `subagent` (run) is always there; `agent_manage` (create, edit, delete) has `deferred` exposure and is
   loaded through `tool_search` when needed. The agent list is a prompt section.
6. **Order:** milestone 1 (running internal agents) first; subagents comes before [analytics](analytics.md) on the
   roadmap, so analytics is built to track runs per agent, model and effort.
7. **The main window orchestrates, and still works.** It hands work to specialists and keeps going, and it can still
   do things itself. It delegates when my request or my instructions say so (as pi-subagents does: "task complexity
   does not grant delegation authority"). A pure orchestrator that never edits, like Radian's coordinator, could be a
   plan-build mode later.
8. **Background by default.** A run returns at once and its answer wakes the main agent when it's done; foreground
   (`background: false`) is for when the next step can't happen without the answer. Runs that finish close together
   arrive as one message, and the main agent can wait for runs on purpose.
9. **Parallel writers each get a worktree**, so [worktree](../tools/worktree.md) moves above subagents on the
   roadmap. Until a writer run has its own worktree, only one `write` run works in the main checkout at a time.
10. **A writer's work comes back as a patch** (pi-subagents' way, not Radian's branch and merge): when the run ends,
    its changes are captured as a patch file and a handoff file, the temporary worktree and branch are removed, and
    the main agent applies the patch.
11. **A writer won't start in a worktree while my checkout has uncommitted changes** (pi-subagents' rule); the
    refusal lists the files so I can commit or stash first. **Applying a patch always asks me first.**

## Agents

Markdown files with frontmatter and the prompt as the body:

| Field | Meaning |
|---|---|
| `name`, `description` | How the parent picks it. |
| `access` | `read-only` or `write`. |
| `tools` | Optional: an exact allowlist of pi tool names, inside what `access` allows. |
| `model` | An exact `provider/id`, or `inherit` for the main session's model. |
| `thinking` | pi's thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |

The builtins ship with `model: inherit`, since a public package can't know which providers someone is logged in to.
I set models once ("make reviewer use luna 6"), which saves my copy over the shipped one:

| Agent | Access | Thinking | Role |
|---|---|---|---|
| `architect` | read-only | high | Designs and plans; challenges the approach before building. |
| `developer` | write | medium | Implements a brief. |
| `reviewer` | read-only | medium | Checks a change against its task: tests, edge cases, simplicity. |

**Where they live:** the builtins in the module's folder; mine in `~/.pi/agent/agents/` (the default for new ones); a
project's in `.pi/agents/`, loaded only in a trusted project. A name in my folder or the project's wins over a
builtin.

**The prompt section** lists each agent in one line (name, description, model, thinking, access) and says how to
create or change one ("load `agent_manage` through `tool_search`"). It goes through MyPi's `PromptManager`, which
updates it when an agent is added or changed.

## Running an agent

- **`subagent({ agent, task, model?, thinking?, background? })`**, `background` true by default. `model` and `thinking` override the definition for
  this one run. An unknown agent is an error that lists the agents.
- **The child** is `createAgentSession({ cwd, modelRuntime, model, thinkingLevel, tools, resourceLoader, sessionManager })`
  with one `ModelRuntime.create()` per pi session. That reads pi's own `auth.json` and `models.json`, so children use
  the models and logins pi has (checked in pi 1.2.0). `SessionManager.create(cwd, dir, { parentSession })` makes
  each child an ordinary pi session file that points to its parent.
- **Fresh context:** the child gets its agent prompt and the task, not my conversation. Starting from my conversation
  (a fork) is a later slice.
- **Background** (default): the call returns at once ("started reviewer as job 3") and the main agent keeps going. The
  child runs as a job in MyPi's [`JobManager`](../tools/background-process.md): `job_list`, `job_stop`, the footer
  count, and the fleet view. When it's done, an exit notice brings its answer into the conversation and wakes the
  main agent (`sendMessage` with `followUp` and `triggerTurn`, like shell jobs). It stops when pi does; its session
  file stays.
- **Grouped completions:** runs that succeed within a short window of each other arrive as one message, so the main
  agent doesn't act on the first of three reviews before the other two land. A failed run is reported at once
  (pi-subagents' `completionBatch`).
- **Waiting on purpose:** the main agent can wait for given runs to finish (pi-subagents' `bg_wait`). Possibly a
  `job_wait` tool in core, which would work for shell jobs too.
- **Foreground** (`background: false`): the call waits, shows the child's progress under it, and returns the answer
  as its result.
- **The result:** the child's final answer, its usage, the path of its session file (the full transcript), and the
  files it changed (from its own tool results). A `developer` that changed nothing says so.
- **No nesting:** children don't get `subagent` or `agent_manage`, and their prompt says they aren't the orchestrator.
- **No questions mid-run** at first: the child puts open questions in its answer. Asking the parent is a later slice.
- **Limits:** a 30-minute default timeout, a few background runs at once, and a cap on runs per prompt.
- **A missing model** (logged out, retired) fails the run with what to do: edit the agent, or log in.

## Access and Plan mode

MyPi isn't loaded in the child, so MyPi's `ToolGuard` never sees the child's tool calls. The child enforces its own
access:

- **`read-only`:** read tools only (`read`, `grep`, `find`, `ls`), plus `bash` checked by plan-build's `planRule`
  through a small inline extension in the child (`DefaultResourceLoader`'s `extensionFactories`, checked in pi 1.2.0).
- **`write`:** pi's normal tools.
- **In the parent's Plan mode**, the module's own `onToolCall` rule allows a `subagent` run of a `read-only` agent and
  blocks a `write` agent with a reason. pi's generic rule would ask every time, since `subagent` isn't read-only.
- **Writers in parallel each get a worktree** (the [worktree](../tools/worktree.md) tool comes first on the roadmap).
  Without one, only one `write` run works in the main checkout at a time, and the main agent leaves its files alone.
- **Children don't commit. A writer's work comes back as a patch:**
  1. The worktree branches from the main checkout's `HEAD`.
  2. When the run ends, MyPi stages everything in the worktree (new files too) and writes `git diff --cached --binary`
     to a patch file, plus a handoff file: the agent, the task, the base commit, the files changed, the patch's path,
     and the child's summary.
  3. The worktree and its branch are removed. The patch and handoff stay until the patch is applied or dropped.
  4. The run's result names the patch and the files. The main agent reviews it and calls `subagent_apply`, which
     asks me first: a dialog with the agent, the task, the files and their diff stat, and the child's summary, and
     Apply, Drop, or Cancel (Cancel is the default, as in Radian's merge dialog). Apply runs `git apply --3way` (Build
     only); a clash is reported, never forced. Patches are applied one at a time.
- **Uncommitted changes refuse a worktree writer:** the worktree comes from `HEAD`, so the child wouldn't see work I
  haven't committed, and its patch could clash with it. Before launch, `git status --porcelain` must be empty
  (MyPi's own state folders aside); otherwise the run is refused with the list of files. Nothing falls back to the
  main checkout on its own.
- **No `git apply` through `bash`:** the prompt section tells the main agent to apply patches only with
  `subagent_apply`, since a `bash` call in Build wouldn't ask me.

## Creating and changing agents

- **`agent_manage({ action: "create" | "edit" | "delete", … })`**, exposure `deferred`: it costs no context until
  `tool_search` loads it. Never read-only.
- **Every call asks me** through the `ToolGuard` confirm, showing the whole definition: name, the prompt's first lines
  (the full text one key away), model, thinking, access, tools, and where it's saved. Anything I didn't say, such as
  a default model, is shown before it's saved.
- **Model names** are resolved with pi's `resolveCliModel` (exact ID, fuzzy ID or name, `provider/id`, `:level`). Two
  matches → ask me which; none → say so. The file stores the exact ID.
- **Thinking above what the model supports** is shown as the level that will actually run.
- **Saved** to `~/.pi/agent/agents/` unless I ask for the project's `.pi/agents/`.
- **Builtins** can't be deleted. Editing one saves my copy; deleting my copy brings the builtin back.
- **Allowed in Plan mode:** a definition isn't project code.

## Fleet view

One place to see and manage agents and their runs:

- **Collapsed**, a line below the editor: `2 running · reviewer 38s · developer 4m 10s`.
- **Runs** (expanded, a key on the empty editor or `/agents`): one row per run with agent, model, thinking, state,
  time, and tokens. Actions: open (the output and transcript), stop. Later: steer.
- **Agents:** the definitions, with create, edit, and delete. The model list is only models I can use
  (`modelRegistry.getAvailable()`), and the thinking list only the levels the chosen model supports. Saving goes
  through the same rules as `agent_manage`.
- **Data:** every run is a `JobManager` job with run details on it, so `job_list`, `job_stop`, the footer, and the
  fleet view read one list.

## External agents (later)

Deferred until internal agents work. The design so far:

- **What:** another harness (Claude Code, Codex, and later others herdr knows) in its normal interactive mode, in a
  herdr pane beside pi, managed with herdr: `pane split`, `agent start --kind`, `agent prompt`, `agent read`,
  `agent wait`, `pane get`, `pane close`. That's how I can watch and type into it. Why: each harness runs its own
  models on my subscription, and Claude Code uses Anthropic models more efficiently than an API key.
- **Herdr required:** external agents need pi to run inside herdr. The check: `HERDR_ENV=1` and `HERDR_PANE_ID` at
  session start, and `herdr pane current --current` right before each launch. Outside herdr they're listed as
  unavailable, and the `subagent` tool tells the model why. Nothing falls back to an internal agent on its own.
- **Definitions** gain a `runner` (`claude`, `codex`, …; internal agents are `pi`). The menu picks the harness first,
  then its models and effort, since pi's registry can't list Claude Code's.
- **Always background:** the call returns once the agent has its task. The answer comes back through a report file
  the task names, plus herdr's status (`done`, `blocked`), as a follow-up message.
- **No usage or cost numbers:** interactive panes don't report them. The fleet view shows state and time for
  external runs; spend is in each harness's own usage screen.
- **Lessons from Radian:**
  - Blank the variables that move a harness onto API billing, a custom endpoint, or a proxy (`ANTHROPIC_API_KEY`,
    `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `HTTPS_PROXY`, …), so it uses
    my login. Radian also kept Anthropic models on Claude Code only.
  - Type the task only once the pane shows the harness's own input, not a "trust this folder" prompt; herdr doesn't
    always report that prompt. The screen patterns will break when a harness changes its screen, so make that
    visible and never type at the wrong moment.
  - Access per harness: Claude Code with `--tools` and `--allowedTools` and `--permission-mode dontAsk` (read-only:
    `Read,Glob,Grep`); Codex with `--sandbox read-only` or `workspace-write` and approvals `never` (flags checked
    against Claude Code 2.1.286 and Codex 0.162.0).
  - Panes in a grid to the right of pi's pane (`1|3`, `2|4`, …), opened without taking focus.
  - Save pane records (`Session.save`), so a pane that outlives a `/reload` or restart is found again.
  - Fleet actions for panes: focus (`herdr agent focus`), type into it, stop.

## Design in pi

| Piece | Where | Notes |
|---|---|---|
| Module | `BaseModule`, `src/module/subagents/` | `ON_LOAD`. |
| Agent files | A pure parser (frontmatter + body), tested; a loader over the three folders | Builtins in the module's folder. |
| Prompt section | `BaseModule.setPrompt` | The agent list; refreshed when an agent changes. |
| `subagent` | `src/module/subagents/tools/`, from `tools()` | `direct` exposure. Streams progress with `onUpdate`, passes the `signal` to the child's `abort()`. |
| `agent_manage` | Same folder | `deferred` exposure; the confirm comes from a rule on `ToolGuard` that always asks. |
| `subagent_apply` | Same folder | Applies or drops a writer's patch after a dialog with the diff stat and summary; never applies without my answer. |
| Plan rule | `onToolCall` in `init()` | Read-only runs allowed, write runs blocked, while the parent is in Plan. |
| Child session | `createAgentSession`, `ModelRuntime`, `SessionManager`, `resolveCliModel`, `DefaultResourceLoader` | All exported by pi 1.2.0. Dispose a child by emitting `session_shutdown`, then `dispose()`. |
| Background | `session.jobs` (`JobManager`), with run details on the job | One list for `job_list`, `job_stop`, the footer, and the fleet view. |
| Fleet view | `src/ui/` widget through `ctx.ui.setWidget`, plus `/agents` | Built from `src/ui/components/`. |
| Rendering | `renderCall` / `renderResult` | The agent and the task's first line; the child's last few steps; Ctrl+O expands. |

## Slices

**Milestone 1: run internal agents**

1. Spike: a command creates an in-memory child with `createAgentSession` and `ModelRuntime.create()`, sends one
   prompt, and prints the answer. Proves models, logins and tools work in process.
2. Agent definitions: the parser with tests, the three builtins, the three folders with my copy winning, and the
   prompt section.
3. The `subagent` tool: background by default through `JobManager`, the exit notice that wakes the main agent, the
   result (answer, usage, session file, changed files), and `background: false` for foreground.
4. Access in the child (read-only tools, Plan's shell check) and the Plan rule; one writer at a time.
5. Grouped completions, and waiting on purpose.
6. Rendering: progress under a foreground call; Ctrl+O expands.

**Milestone 2: the fleet view and parallel writers**

7. The fleet view's runs: the collapsed line, the expanded list, open, stop.
8. Parallel writers, each in its own worktree (refused while the checkout has uncommitted changes); their work comes
   back as a patch and a handoff file, applied through `subagent_apply` after I approve.

**Milestone 3: creating agents**

9. `agent_manage` (deferred): create, edit, delete, the confirm, model resolution, the actual thinking level.
10. The fleet view's agents: create, edit, delete from the menu.

**Later**

11. Fork context, a child asking the parent, steering a running child.
12. External agents in herdr panes.

## Open questions

- Where do child session files go: pi's session folder (they'd show in `/resume`), or a folder of their own?
- How many background runs at once, and how many runs per prompt?
- How close together is "close together" for grouped completions?
- The fleet view's key, and whether `/agents` replaces `job_list` for runs.
- Should the [done check](done-check.md) run when a `developer` run finishes?
- External agents: keep Radian's rule that Anthropic models only run on Claude Code?

## References

- [pi-subagents](../inspiration/pi-subagents.md): `src/runs/shared/child-session.ts`, `docs/agents.md`,
  `docs/observability.md` § FleetView
- [Radian](https://github.com/cenron/radian-harness): `src/core/runtime-args.ts`, `src/io/herdr.ts`,
  `src/workers/dispatch.ts`, `docs/Architecture.md`
- pi: `createAgentSession`, `ModelRuntime`, `SessionManager`, `resolveCliModel`, `DefaultResourceLoader` (exported
  from the package), `ctx.ui.setWidget`, `docs/sdk.md`, `docs/cli.md` § `--model`
- Claude Code: [sub-agents](https://code.claude.com/docs/en/sub-agents)
