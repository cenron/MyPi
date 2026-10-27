# Sub-agents

**Status:** milestones 1–3 done 2026-10-26. `agent_manage` creates, edits, and deletes definitions with approval;
`/agents` lists, creates, edits, and deletes definitions.

**Load type:** `ALWAYS` (decided 2026-10-25, was `ON_LOAD`): a foundational module other parts build on, like
memory. It's still a module, with its own folder and seams, but it isn't turned off in `/modules`, so research and
checks can count on it.

## Goal

Let the agent hand a task to a sub-agent that runs with its own context window, tools, model and effort, and reports
back. This keeps the main context small, lets a second model check the work, and lets each kind of job go to the
model that suits it.

Agents are set up once per responsibility (an architect, a developer, a reviewer), each with its own model and effort,
and reused. I add more by asking ("create me a tester sub-agent that writes tests from the spec, using luna 6") or in
the fleet view, which also shows what's running.

## Foundational: background research and checks (decided 2026-10-25)

Claude Code starts small background agents freely: to look something up, to check work, to read a lot and report a
little. Only the summary reaches the main conversation, so its context stays small. Building worktree in one pi
session showed the cost of not having that: whole files of pi's compiled code and long command output filled the
main context to 253k, and the code drifted as it did ([context](context.md)).

Two uses (agreed 2026-10-25, following Claude Code):

1. **The model offloads work on its own.** When a task means reading or searching widely, or an independent check,
   the main agent starts a generic subagent without being asked: "find where pi resolves session cwd", "check this
   diff against `docs/principles.md`". Two builtins, like Claude Code's: **`explore`** (read-only, for searching and
   checking) and **`general`** (can write, for a multi-step task handed off whole). Both **inherit the parent's
   model and thinking level**, so they're as capable as the session that started them. Only the short answer comes
   back.
2. **The user's own agents:** a reviewer, a developer, an architect, and any the user creates, by asking or in the
   jobs view (milestones 2 and 3).
- **Other parts may build on it:** a check after a slice (the reviewer against the principles), research during
  planning. That's why it's `ALWAYS`. Each still works without a subagent run in flight; they use it, they don't
  wait on it to start.
- Earlier (2026-10-25) the user preferred not to depend on subagents, since they might not always be around; making
  them foundational is what settles that.

## Where the ideas come from

- **[pi-subagents](../inspiration/pi-subagents.md):** children through pi's own SDK, agents as Markdown, read-only
  roles, no nesting, evidence in the result, and a fleet view.
- **[Radian](https://github.com/cenron/radian-harness)**, my own earlier harness: other harnesses as interactive
  sessions in herdr panes, on my subscriptions. That's the [external agents](#external-agents-later) part, deferred.
- **Claude Code** ([sub-agents](https://code.claude.com/docs/en/sub-agents)): built-in Explore, Plan, and
  general-purpose agents that inherit the main model and its thinking setting; the model delegates on its own from
  each agent's description ("use proactively"); agent files with a tool allowlist, a model, and an effort level;
  fresh context plus CLAUDE.md, or a fork; background by default; only the final report comes back.

## Decisions (2026-10-23)

1. **Internal and external.** An internal agent is pi itself: a pi session made with pi's SDK inside pi's process.
   An external agent is another harness (Claude Code, Codex, …) started in its interactive mode in a herdr pane and
   managed through herdr. Pi is always internal. No headless `claude -p` or `codex exec`. **External agents are
   deferred:** internal first.
2. **Definitions, not one-off agents.** An agent is a reusable definition for a responsibility; a run is that agent
   doing one task. MyPi ships the generic `explore` and `general` (2026-10-25) and the named `architect`,
   `developer`, and `reviewer`. I add agents by asking the model or in the fleet view.
3. **Creating, editing and deleting always ask me**, with the whole definition shown. Saved globally by default.
   Allowed in Plan mode; running a `write` agent isn't. Builtins can't be deleted, only overridden by my own copy.
4. **Models and effort:** a loose name ("luna 6") is resolved once, at creation, to an exact `provider/id`; if it
   matches several models, the model asks me. The level actually used is shown when pi lowers it. A missing model
   fails clearly. `inherit` (the main session's model) is a deliberate choice, and the builtins ship with it.
   **Thinking inherits too** by default (2026-10-25, as in Claude Code): a definition may set its own level, and
   one run may override it.
5. **Tools:** `subagent` (run) is always there; `agent_manage` (create, edit, delete) has `deferred` exposure and is
   loaded through `tool_search` when needed. The agent list is a prompt section.
6. **Order:** milestone 1 (running internal agents) first; subagents comes before [analytics](analytics.md) on the
   roadmap, so analytics is built to track runs per agent, model and effort.
7. **The main window orchestrates, and still works.** It hands work to subagents and keeps going, and it can still
   do things itself. **It may delegate on its own** (changed 2026-10-25, was "only when my request or my
   instructions say so"), guided by each agent's description in the prompt section, as Claude Code's model is. My
   instructions can still ask for a subagent or rule one out. Delegating costs a cold start, so the section says when
   it pays off: wide reading or searching, an independent check, or a task that would flood the main context; not a
   quick lookup or a one-file change. The per-prompt run limit is the backstop. A pure orchestrator that never edits,
   like Radian's coordinator, could be a plan-build mode later.
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
| `name`, `description` | How the parent picks it: the description is all it sees (see "Writing agent files"). |
| `access` | `read-only` or `write`. |
| `tools` | Optional: an exact allowlist of pi tool names, inside what `access` allows. |
| `model` | An exact `provider/id`, or `inherit` for the main session's model. |
| `thinking` | `inherit` (the default) or pi's thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |

The builtins ship with `model: inherit`, since a public package can't know which providers someone is logged in to.
Thinking is set per agent (2026-10-26): `explore` runs at `medium` (search and a short summary, where deeper thinking on
every step costs more than it finds), `reviewer` and `architect` at `high` (catching subtle bugs, and design, where
reasoning pays; fixed, so they stay high when the main session runs lower), and `developer` and `general` `inherit`
the main session's. A model that can't run a level runs the nearest one it can. I set models once ("make reviewer use luna 6"), which saves my copy over the shipped one:

| Agent | Kind | Access | Role |
|---|---|---|---|
| `explore` | generic | read-only | Searches and checks across many files; answers briefly with file and line. |
| `general` | generic | write | Carries out a multi-step task handed off whole; reports what it did and how it checked it. |
| `architect` | named | read-only | Designs and plans before building; challenges the approach. |
| `developer` | named | write | Implements a written brief. |
| `reviewer` | named | read-only | Checks a change against its task: correctness, tests, edge cases, simplicity; searches for existing helpers and constants by name and behavior and lists duplicates; when given a plan or checklist, checks each box and reports any unmet or differently met box. |

### Writing agent files

Learned from Claude Code's built-in descriptions and its examples (2026-10-25):

- **The description says when to use it,** not only what it is, since it's all the parent sees when deciding:
  "Use proactively when answering means reading or searching widely". Name what comes back and what it won't do
  ("locates code; doesn't review it"), so the parent doesn't misuse it, and what to pass ("say how thorough").
- **Keep descriptions short.** Every one sits in the parent's prompt on every request; detail goes in the body,
  which loads only when the agent runs.
- **The body is short too:** one line of role, a few rules for how to work, and the exact shape of the answer.
- **Every body says the agent isn't the orchestrator:** do the task and report; don't plan the rest of the work.

The builtins' text is drafted in the [milestone 1 plan](#slices) checkpoint 2, to be kept as written unless the live
check shows a problem.

**Where they live:** the builtins in the module's folder; mine in `~/.pi/agent/agents/` (the default for new ones); a
project's in `.pi/agents/`, loaded only in a trusted project. A name in my folder or the project's wins over a
builtin.

**The prompt section** lists each agent in one line (name, description, model, thinking, access), says when
delegating pays off (decision 7), and says how to create or change one ("load `agent_manage` through
`tool_search`"). It goes through MyPi's `PromptManager`, which
updates it when an agent is added or changed.

**Wording the delegation (live, 2026-10-26).** With one abstract line ("delegate wide searches…") and a one-line tool
description, gpt-6-luna searched pi's package itself, even though `explore`'s description says "use proactively".
After the section and the tool description were worded like Claude Code's, it chose `explore` on its own for the
same question and still answered a one-file question itself. What worked: a concrete trigger ("more than about
three queries, or spans many files or another package"), "without being asked", what it saves ("only its answer
comes back to yours"), and naming what to do yourself.

## Running an agent

- **`subagent({ agent, task, model?, thinking?, background? })`**, `background` true by default. `model` and
  `thinking` override the definition for this one run. An unknown agent is an error that lists the agents.
- **The child** is `createAgentSession({ cwd, modelRuntime, model, thinkingLevel, tools, resourceLoader, sessionManager })`
  with one `ModelRuntime.create()` per run. That reads pi's own `auth.json` and `models.json`, so children use
  the models and logins pi has (checked in pi 1.2.0). `SessionManager.create(cwd, dir, { parentSession })` makes
  each child an ordinary pi session file that points to its parent.
- **Fresh context:** the child gets its agent prompt and the task, not my conversation, plus the project's
  `AGENTS.md` (like Claude Code's CLAUDE.md) for every agent except `explore`, which skips it as Claude Code's
  Explore does: it only searches. Starting from my conversation (a fork) is a later slice.
- **Background** (default): the call returns at once ("started reviewer as job 3") and the main agent keeps going. The
  child runs as a job in MyPi's [`JobManager`](../tools/background-process.md): `job_list`, `job_stop`, the footer
  count, and the fleet view. When it's done, an exit notice brings its answer into the conversation and wakes the
  main agent (`sendMessage` with `followUp` and `triggerTurn`, like shell jobs). It stops when pi does; its session
  file stays.
- **Grouped completions:** runs that succeed within 3 seconds of each other arrive as one message, so the main
  agent doesn't act on the first of three reviews before the other two land (pi-subagents' `completionBatch`). Each
  success restarts the wait; a failed run is reported at once and doesn't flush the others. A `NoticeGroup` in
  `src/core/job-notice.ts`; shell jobs aren't grouped. Live: of three reviewers started together, the two that
  ended 0.8 seconds apart came as one message and the one that ended 12 seconds later came alone.
- **Waiting on purpose:** `job_wait` in core, for any job (pi-subagents' `bg_wait`). See
  [background process](../tools/background-process.md#job_wait).
- **Foreground** (`background: false`): the call waits, shows the child's progress under it, and returns the answer
  as its result. The call is drawn as the agent and the start of the task; while it runs, the child's last five steps
  (`onUpdate`, drawn from `details`) show under it; the finished answer shows its first 500 characters. Ctrl+O
  expands either. A background call shows "started as job N".
- **The result:** the child's final answer, its usage (tokens and cost over the run), the path of its session file
  (the full transcript), and the files it changed (from its own tool results). A `developer` that changed nothing
  says so; a run stopped at the time limit says so. A background run's notice carries the whole result, not the
  job's last lines; its steps go to the job's log. The job's label is the agent and the start of the task.
- **No nesting:** children don't get `subagent` or `agent_manage`, and their prompt says they aren't the orchestrator.
- **No questions mid-run** at first: the child puts open questions in its answer. Asking the parent is a later slice.
- **Limits:** a 30-minute default timeout, a few background runs at once, and a cap on runs per prompt.
- **A missing model** (logged out, retired) fails the run with what to do: edit the agent, or log in.

## Access and Plan mode

MyPi isn't loaded in the child, so the parent's `ToolGuard` never sees the child's tool calls. The child gets its own:
an inline extension (`access.ts`, through `DefaultResourceLoader`'s `extensionFactories`) builds a `ToolGuard` with
MyPi's own rules (`registerRules`, as the parent does), fills their prompt paths from the child's
`before_agent_start`, and checks every `tool_call`. A child has no UI (`ctx.hasUI` is false, seen live), so the
guard turns any ask into a block with the reason ("Refused: this call needs the user's approval, and no one can give
it here (no UI). Tell the user what you needed and why: …").

- **`read-only`:** `read`, `grep`, `find`, `ls`, and `bash`, with the Plan rule (`planRule`, `src/core/plan-rule.ts`) on the child's guard: the
  same check as Plan, so `git log` runs and `touch` is refused. One exception: the project's check commands the user
  already approved for the done check (`.pi/done-check.json`) run exactly as written, so a `reviewer` can run the
  tests. Before a read-only run, `subagent` asks the done check for them on the event bus (`checkCommands`); it
  answers only with a list the user approved on this machine, and never asks. The child's prompt names them, with
  nothing added (a pipe or another argument is a different command, refused as before). With the done check off,
  nobody answers and a child runs no checks.
- **`write`:** pi's normal tools.
- **Clearer refusals:** when there's no UI, `ToolGuard` says the call needs the user's approval and no one can give
  it here, then includes what needed confirming. When a child reports a refused call, the prompt tells the parent to
  explain what it needed and why, offer to take the step here where the user can approve it, and not retry the child
  with the same call.
- **The folder guard, in every child** (gap found 2026-10-25 planning milestone 1): MyPi's `FolderRule` doesn't run
  in a child either, so an `explore` run could read `~/.ssh` unasked. The child's guard runs it; a call reaching
  outside the session's folder is refused with the reason, and the child reports it in its answer so the parent can
  ask the user. Like the parent, it allows the temp folder.
- **In the parent's Plan mode** a `read-only` agent runs without asking and a `write` agent is refused with the
  reason. A rule can't do this: no rule can override `planRule`'s ask on a tool not marked read-only. So `subagent`
  carries `readOnlyHint: true`, and its `execute` asks plan-build for the mode on the event bus (as the done check
  does) and refuses a `write` agent in Plan. With plan-build off, nobody answers, which counts as Build.
- **Writers in parallel each get a worktree.** In a git project, up to three `write` runs work in separate managed
  worktrees; outside git, a single writer runs in place and says so (foreground and background alike).
- **Children don't commit. A writer's work comes back as a patch:** the child runs in its worktree and is told not to
  commit. On completion, including a stopped run, `writer.ts` captures the work, removes the worktree, and returns the
  patch name and files; the main agent reviews it and uses `subagent_apply`. A dirty calling checkout refuses the run
  and names the files; there is no fallback to in-place work.
  1. The worktree branches from the **calling checkout's committed `HEAD`** (decided 2026-10-25), matching
     `Session.worktrees.create`. If the parent works inside a worktree, the writer branches from that checkout,
     not the primary checkout. Storage remains under the main checkout's `.pi/worktrees/`. The clean-caller
     preflight below applies to the calling checkout. `prepareWriter` in `src/module/subagents/writer.ts` refuses
     any `git status --porcelain` output and lists the caller's files before creating the worktree.
  2. `captureWork` stages everything in the worktree (`git add -A`) and writes `git diff --cached --binary <base>`
     to `.pi/patches/<name>.patch`, plus `<name>.md`: the agent, task, base commit, files changed, diff stat, patch
     path, and child's summary. No-change runs create no patch or handoff.
  3. After both files are saved, `Session.worktrees.discard(name)` removes the managed worktree with force and deletes
     its branch. It still refuses new or changed `.pi/memories/` and `.pi/plans/` files, which a patch cannot carry;
     if that happens, the worktree stays and the refusal names the files. Patches and handoffs stay until applied or
     dropped. See [worktree](../tools/worktree.md#subagent-integration).
  4. The run's result names the patch and the files. The main agent reviews it and calls `subagent_apply`, which
     asks me first: a dialog with the agent, the task's first line, the diff stat, and the child's summary, and
     Cancel, Apply, or Drop (Cancel is the default, including Escape). Apply preflights with a three-way check before
     running `git apply --3way` (Build only), which leaves the change staged; a clash is reported with git's output without changing the checkout, and
     both files are kept. On success, the patch and handoff are deleted and
     the result lists the files. Drop deletes both files; Cancel changes nothing. Unknown names list the available
     patches, and without a UI the tool refuses because my approval is required. The prompt says never to use
     `git apply` through `bash`, which wouldn't ask me. Patches are applied one at a time.
- **A repository with no commit refuses a worktree writer**, saying to make a first commit: a worktree starts from a
  commit. Found 2026-10-26 in a live check, where git's raw "ambiguous argument 'HEAD'" left the model guessing.
- **Uncommitted changes in the calling checkout refuse a worktree writer:** the worktree comes from its `HEAD`, so
  the child wouldn't see work I haven't committed, and its patch could clash with it. Before launch, `git status --porcelain` must be empty
  (MyPi's own state folders aside); otherwise the run is refused with the list of files. Nothing falls back to the
  main checkout on its own.
- **No `git apply` through `bash`:** the prompt section tells the main agent to apply patches only with
  `subagent_apply`, since a `bash` call in Build wouldn't ask me.

## Creating and changing agents

- **`agent_manage({ action: "create" | "edit" | "delete", … })`**, exposure `deferred`: it costs no context until
  `tool_search` loads it. Never read-only. The prompt section points the model to `tool_search` when it needs to manage
  definitions.
- **Every call asks me** through the `ToolGuard` confirm. Create and edit show the definition fields, exact model,
  actual thinking level, destination, and the prompt's first lines. Delete shows the file and whether a builtin will
  return. Without a UI, the guard refuses the call.
- **Create** needs a description and prompt. Edit changes only fields supplied. Names are lowercase letters, digits,
  and hyphens, matching the worktree name rule. An existing name must be edited, not created again.
- **Model names** are resolved against pi's available models through `resolveCliModel`. A loose name must match exactly
  one model; none or several fail with the matches listed. `inherit` remains `inherit`, and files store an exact
  `provider/id` for every resolved model.
- **Thinking above what the model supports** is shown as the level that will actually run; the file keeps the
  requested level.
- **Saved** to `~/.pi/agent/agents/` by default, or to the trusted project's `.pi/agents/` when requested.
- **Builtins** can't be deleted. Editing one saves a user copy; deleting a user copy restores the builtin.
- **Allowed in Plan mode:** a definition isn't project code. Only the agent folders are writable for `agent_manage`.
- **After a change**, the module reloads definitions and updates its prompt section for the next request.

## Agents view

`/agents` lists each definition with its source, model, thinking level, and access. Enter shows the full definition;
`e` edits it in pi's editor, `n` creates a user agent from a template, and `d` deletes a user or project definition
after confirmation. Builtins can't be deleted. Editing a builtin saves a user copy; editing a project definition saves
back to `.pi/agents/`. Invalid editor text is refused with the parser's message. Changes reload the list and prompt
section.

## Jobs view

The user's `/jobs` view covers every `JobManager` job, including shell jobs and subagents:

- **Collapsed**, a `mypi-jobs` line below the editor while jobs run: count, each running job's label (cut to 24
  characters) and elapsed time, then `/jobs`. It redraws each second and disappears when jobs end. This replaces the
  footer's job count.
- **`/jobs`** lists every job newest first with id, kind, state, time, and label. Enter opens its last 100 output
  lines and log path; Escape goes back or closes. `x` stops the selected running job.
- **Model tools remain:** `job_list`, `job_stop`, and `job_wait` are still available to the model. The jobs view is
  for the user; it uses the same session `JobManager`.

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
| Module | `BaseModule`, `src/module/subagents/` | `ALWAYS` (foundational, 2026-10-25). |
| Agent files | A pure parser (frontmatter + body), tested; a loader over the three folders | Builtins in the module's folder. |
| Prompt section | `BaseModule.setPrompt` | The agent list; refreshed when an agent changes. |
| `subagent` | `src/module/subagents/tools/`, from `tools()` | `direct` exposure. Streams progress with `onUpdate`, passes the `signal` to the child's `abort()`. |
| `agent_manage` | Same folder | `deferred` exposure; the confirm comes from a rule on `ToolGuard` that always asks. |
| `subagent_apply` | Same folder | Applies or drops a writer's patch after a dialog with the diff stat and summary; never applies without my answer. |
| Plan rule | `onToolCall` in `init()` | Read-only runs allowed, write runs blocked, while the parent is in Plan. |
| Child session | `createAgentSession`, `ModelRuntime`, `SessionManager`, `resolveCliModel`, `DefaultResourceLoader` | All exported by pi 1.2.0; see "Spike results" below. Dispose a child with `session.dispose()`. |
| Background | `session.jobs` (`JobManager`), with run details on the job | One list for `job_list`, `job_stop`, `job_wait`, and `/jobs`. |
| Jobs view | `src/ui/` widget through `ctx.ui.setWidget`, plus `/jobs` | Lists every job, opens output, and stops running jobs; agent-definition management remains milestone 3. |
| Rendering | `renderCall` / `renderResult` | The agent and the task's first line; the child's last few steps; Ctrl+O expands. |

### Spike results (milestone 1 checkpoint 1, 2026-10-26)

A throwaway script ran a child in process on gpt-6-luna with the OpenAI subscription login:

- **Pass the model explicitly.** `ModelRuntime.create()` uses pi's own logins, but left to choose it picked the first
  available model, `gpt-4`, which the subscription rejects. `inherit` passes the parent's current model.
- **`DefaultResourceLoader({ noExtensions: true, systemPrompt })`.** Without `noExtensions` the child loads the
  user's global extensions, MyPi included, and MyPi's `bash` wrapper failed looking for the parent's `toolGuard`.
  A child gets only its own inline extension (access and the folder guard).
- **The answer and usage:** `session.getLastAssistantText()`, and the usage on the last assistant message in
  `session.messages`.
- **The session file:** `SessionManager.create(cwd, sessionDir, { parentSession })` writes it in the given folder with
  the parent's path.
- **Shutdown:** `session.dispose()` is public and aborts any work in flight. Emitting `session_shutdown` needs an
  internal `ExtensionRunner` that `createAgentSession` doesn't expose; since a child's only extension is MyPi's
  inline one, which holds nothing to clean up, `dispose()` is enough.

## Slices

**Milestone 1: run internal agents**

1. Spike: a command creates an in-memory child with `createAgentSession` and `ModelRuntime.create()`, sends one
   prompt, and prints the answer. Proves models, logins and tools work in process.
2. Agent definitions: the parser with tests, the five builtins (`explore` and `general` generic), the three folders with my copy winning, and the
   prompt section.
3. The `subagent` tool: background by default through `JobManager`, the exit notice that wakes the main agent, the
   result (answer, usage, session file, changed files), and `background: false` for foreground.
4. Access in the child (read-only tools, Plan's shell check, the folder guard) and the Plan rule; one writer at a
   time.
5. Grouped completions, and waiting on purpose.
6. Rendering: progress under a foreground call; Ctrl+O expands.

**Milestone 2: the jobs view and parallel writers**

7. **Done 2026-10-26: Jobs view.** The below-editor line and `/jobs` list every session job, open output, and stop
   running jobs. Agent-definition management remains milestone 3.
8. Parallel writers, each in its own worktree (refused while the checkout has uncommitted changes); their work comes
   back as a patch and a handoff file, applied through `subagent_apply` after I approve.

**Milestone 3: creating agents**

9. **Done 2026-10-26:** `agent_manage` (deferred): create, edit, delete, the confirm, model resolution, the actual thinking level.
10. **Done 2026-10-26:** `/agents` lists definitions and lets the user create, edit, and delete them from the menu.

**Later**

11. Fork context, a child asking the parent, steering a running child.
12. External agents in herdr panes.

## Open questions

Answered for milestone 1 (2026-10-25), as defaults to revisit with real use:

- **Child session files:** their own folder, `<agentDir>/subagents/sessions/`, so they don't crowd `/resume`; each
  points to its parent (`parentSession`), and the run's result gives its path.
- **Limits:** 3 background runs at once, 8 runs per prompt, a 30-minute timeout per run.
- **Grouped completions:** runs that succeed within 3 seconds of each other arrive as one message.

Still open:

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
