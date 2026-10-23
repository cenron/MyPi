# pi-subagents

**Source:** [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents), read at `34e1651` (2026-10-22,
v0.81.0). **License:** MIT. One maintainer; about 4,000 stars, 0 open issues, pushed daily.

## What it is

A pi package that lets the parent session hand work to child agents: `pi install npm:pi-subagents`. It's large
(about 275,000 lines with tests) and covers far more than delegation: workflows, parallel lanes, worktrees, missions
and schedules, an adversarial "watchdog" reviewer, external CLI agents (Claude Code, Codex, Cursor), a fleet view, and
herdr integration.

## How it runs a child

- **A child is a full pi session made with pi's SDK**, `createAgentSession`, not a `pi` process and not pi-durable
  (`src/runs/shared/child-session.ts`).
- **Models and logins come from pi:** `ModelRuntime.create()` reads pi's own `auth.json` and `models.json`, and the
  agent's `model` is resolved with pi's `resolveCliModel`.
- **Foreground children** run inside the parent's process and stream into the conversation. **Background children**
  run in a detached runner process, so they keep going after control returns, and can be checked later.
- **Each child is an ordinary pi session file**, with the parent's session file in its header (`parentSession`), the
  way pi records forks. A child can start **fresh** (only its task) or as a **fork** of the parent's conversation,
  which reuses the parent's prompt cache.
- **Tools are a strict allowlist** from the agent file. Foreground children never load the parent's other
  extensions; only extensions the agent lists.

## What's worth taking

| Idea | How it does it | For MyPi |
|---|---|---|
| Children through pi's SDK | `createAgentSession` + `ModelRuntime.create()` + `SessionManager.create(cwd, dir, { parentSession })` | The route for [subagents](../modules/subagents.md). Answers our open question: children use the models and logins pi already has. No experimental dependency. |
| Agents as Markdown | Frontmatter: `name`, `description`, `tools`, `model`, `thinking`, prompt in the body; builtins overridable from the user's and the project's folders | The same, with a much smaller set of fields. |
| A few clear builtin roles | `scout` (recon, cheap), `worker` (edits), `reviewer` (checks), `oracle` (second opinion, no edits) | Ship the same four. |
| No nesting by default | Children don't get the `subagent` tool and are told they aren't the orchestrator; a depth limit for the agents that may delegate | Depth 1 to start. |
| Fresh by default for workers, fork for advisors | A worker starts from its brief; an oracle sees the conversation | Fresh first; fork later. |
| Evidence closes work | "A child saying it is done is not enough": changed files, checks run, or an explicit blocked state | The result lists the files the child changed. Pairs with the [done check](../modules/done-check.md). |
| The child can ask | `contact_supervisor` with a reason (`need_decision`, `progress_update`); the parent answers with `subagent_supervisor` | A later slice; the first version tells the child to put its questions in its answer. |
| A small loader instead of the big schema | A fresh parent sees only `subagents_enable`; calling it turns `subagent` on for the next request | The same idea as our "schemas cost context" rule. Check pi's tool `exposure` options first. |
| Limits | 30-minute default timeout, a spawn budget per run, a depth limit | Copy the defaults. |
| Background stays visible | A fleet view below the editor; work that runs out of sight never disappears | Our `JobManager` footer count and `job_list` already do this for shell jobs. |
| External agents | Headless one-shot adapters (`claude -p --output-format stream-json`, `codex exec --json`), and children placed in herdr panes | Not the headless adapters. MyPi's external agents are other harnesses in their interactive mode in herdr panes, Radian's way, so I can watch and type into them. Deferred until internal agents work. |
| A fleet view | A line below the editor (`2 active agents · …`) that expands into one row per child with state, time and tokens; an inspector to read transcripts, steer, or stop | The fleet view over MyPi's `JobManager`, which also creates, edits, and deletes agents. |
| "Compose before inventing" | Its VISION.md: a new mode or runner only when existing pieces can't do it | Same as our principles. |

## Not for MyPi

- **Its size.** Workflows, missions, schedules, councils, and the watchdog are each a project of their own. (The fleet
  view is taken, and external agents in a different form.)
- **Headless external adapters.** MyPi's external agents run interactively in herdr panes instead.
- **The detached background runner.** Background children that outlive pi need a second process and its lifecycle;
  MyPi's background children run in pi's process through `JobManager`, like shell jobs, at least at first.
- **Installing it as is:** it would bring its own tools, commands, and UI beside MyPi's. MyPi builds a smaller module
  of its own instead; see the [subagents decisions](../modules/subagents.md#decisions-2026-10-23).

## References

- `README.md`, `VISION.md`
- `docs/agents.md` § Frontmatter reference, `docs/workflows.md` § Recursion guard and § Supervisor coordination,
  `docs/tool-reference.md` § Fork context details, `docs/configuration.md` § toolActivation
- `src/runs/shared/child-session.ts` (the SDK child), `agents/*.md` (the builtin agents)
- `docs/agents.md` § Claude Code profiles, § Codex exec profiles, § Running external CLI agents on a Herdr saved
  machine; `docs/observability.md` § FleetView; `docs/extension-api.md` § Herdr integration
