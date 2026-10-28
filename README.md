# MyPi

MyPi turns [pi](https://pi.dev), the minimal terminal coding agent, into a full working environment: a Plan mode
that can't change your code, a check that sends the agent back when it stops with broken code, subagents that work in
their own git worktrees, code navigation through language servers, memories that carry across sessions, web search
that survives free-tier limits, and local analytics on how all of it is going.

It's one pi package. Install it once and every pi session loads it. Most features are modules you can switch off, and
it works with any model pi supports: nothing depends on one provider.

```text
❯ add retry with backoff to the uploader
  Plan mode: reads the code, asks what it needs to know, writes the plan
  Implement this plan?  → Clear context and implement
  Build mode: tracks each step as a task, edits, runs the tests
  Done check: 1 type error in uploader.ts → sent back, fixed, checks pass
```

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [First session](#first-session)
- [Features](#features)
- [Commands](#commands)
- [Tools the model gets](#tools-the-model-gets)
- [Modules](#modules)
- [Configuration](#configuration)
- [Where things are kept](#where-things-are-kept)
- [Develop](#develop)
- [License](#license)

## Requirements

- **pi 1.4.0** or newer (`pi --version`). MyPi is developed against the version pinned in `package.json`.
- **Node.js 22.19** or newer.
- **git**, for worktrees and for subagents that write code.
- **A model login in pi** (`/login`), for any provider pi supports.
- **Optional:** language servers for the languages you work in (see [Code navigation](#code-navigation)), and API keys
  that raise web search limits (see [Configuration](#configuration)).

MyPi is developed and used on macOS. It should work on Linux; it hasn't been tried on Windows.

## Install

### Use it

```bash
pi install git:github.com/cenron/MyPi
```

Pi clones the repository into its package folder, installs the runtime dependencies, and loads MyPi in every session.
Pin a version with `@<tag>`, and update with `pi update`. Don't edit that checkout: `pi update` resets it.

### Develop it

```bash
git clone https://github.com/cenron/MyPi.git ~/.pi/MyPi
cd ~/.pi/MyPi
npm install
pi install ~/.pi/MyPi
```

Pi loads the checkout in place. Run `/reload` in a session to pick up your edits.

### On a new machine

Either path works. Logins (`~/.pi/agent/auth.json`), your settings, and your sessions aren't part of the package, so
log in again with `/login` after installing.

## First session

Start pi in a project folder. A new session starts in **Plan** mode:

1. **Ask for what you want.** In Plan, the agent can read, search, and run read-only commands, but it can't change
   your files. It explores, asks you about anything it can't decide (with concrete choices to pick from), and writes a
   plan.
2. **Approve the plan.** It submits the plan and asks *Implement this plan?* **Clear context and implement** starts a
   fresh Build session with the plan as its brief; **Implement** continues in the same session.
3. **Build.** The agent works through the plan, tracking each step as a task above the editor. When it stops, the done
   check looks at what it changed and sends it back if something is broken.

Switch modes yourself any time with `/plan` (toggle), `/plan build`, or `/plan plan`.

Other things to try:

- **"How are you looking?"** The agent reads its own analytics and answers with a summary and what stands out.
- **"Have the reviewer check this change."** Runs the reviewer subagent on the current diff.
- **`/onboard`** in a project you're new to: the agent learns the project and saves what a future session needs.
- **`/modules`** to see every module and switch the optional ones off.

## Features

### Plan and Build

- **Plan mode is read-only by rule, not by request.** Edits and writes are refused except in `.pi/plans/` and
  `.pi/memories/`. A shell command runs without asking only when MyPi can tell it only reads (`git log`, `rg`, `ls`,
  `cat`, `sed -n`, and so on); anything else asks you first. Ask for a change while in Plan and the agent says so and
  plans it instead of trying.
- **Plans hand over cleanly.** The plan file is the whole brief, so a fresh Build session can implement it without the
  conversation. `/plan implement [file]` starts that session on the same model and thinking level.

### The done check

When the agent is about to stop in Build, MyPi checks what it changed:

- language-server errors in the changed files;
- your project's own check commands, from `.pi/done-check.json` (for example `{ "commands": ["npm test"] }`), which
  run only after you approve that exact list on your machine;
- tasks the agent left open;
- new functions or types that duplicate ones the project already has.

If something fails, the agent gets the report and another round to fix it. `/done-check` shows the commands and
whether they're approved.

### Task tracking

Claude Code-style task tools (`task_create`, `task_update`, `task_list`, `task_get`). The agent breaks multi-step
work into tasks, and a checklist above the editor shows them as it goes. An approved plan seeds the tasks, and the list
follows `/tree` branches.

### Subagents

The agent can hand work to another agent that runs in its own context and reports back only its answer:

| Agent | Access | Use |
|---|---|---|
| `explore` | read-only | Searching a large codebase or another package |
| `reviewer` | read-only | Checking a change against its task: correctness, tests, edge cases |
| `architect` | read-only | Design questions and trade-offs |
| `developer` | writes | Implementing a well-defined change |
| `general` | writes | Anything else |

- **Writers work in their own git worktree** and come back as a patch you review and apply, so parallel writers never
  collide and nothing lands without you.
- **Read-only agents** follow Plan's rules, and can run your project's approved check commands.
- **Background runs:** subagents can run as jobs while the main agent keeps working.
- **Your own agents:** `/agents` lists, views, creates, edits, and deletes agent definitions (Markdown with
  frontmatter: description, access, model, thinking). The agent can also create them for you with `agent_manage`,
  which asks before every change. Each agent can pin a model and thinking level, or use the session's.

### Code navigation

With a language server installed, the agent finds code by symbol instead of by text search:

- `lsp`: find a symbol by name, jump to its definition, list every reference, outline a file, and read diagnostics;
- `lsp_edit`: rename a symbol across the project, since the language server sees every real use;
- errors in changed files after each Build run, through the done check.

Supported servers (`/lsp` turns each on or off):

| Language | Server | Install |
|---|---|---|
| TypeScript / JavaScript | `tsc` | `npm i -g typescript` (version 7 or later) |
| Go | `gopls` | `go install golang.org/x/tools/gopls@latest` |
| Python | `pyright-langserver` | `npm i -g pyright` |

### Memory

Markdown memories, per project (`.pi/memories/`, git-ignored) and global (`~/.pi/agent/memories/`). The prompt lists
them by name and description, and the agent reads the ones it needs. It saves what's worth remembering as it works,
and you can ask it to. `/onboard` builds a project's first memories; `/memory-check` finds broken `[[links]]` and bad
frontmatter.

### Context

Long sessions stay useful: compaction summaries keep the decisions, the plan, and the next step, and old tool results
are cleared from the context as a session grows.

### Web

- **`web_search`** works without any key. It rotates between Parallel, Exa, and TinyFish (and Tavily when you give it
  a key). A service that fails or hits its rate limit is skipped inside the same call and rests until its limit clears,
  so failures cost no extra tool calls. The model can't call the services' own tools around it.
- **`web_fetch`** reads a URL as markdown: pages with the site navigation removed, plain text, JSON, XML. It refuses
  local and private addresses, and cuts long pages with a note saying where the rest is.

### Background jobs

`bash` takes `background: true` for long-running commands: the call returns at once with a job id and a log file, and
the agent is told when the job ends. `job_list`, `job_wait`, and `job_stop` manage them; `/jobs` shows them to you.

### Safety

- **The folder guard** asks before any tool reaches outside the session's folder, in Plan and Build, naming the exact
  path. *Allow for this session* covers that folder for the rest of the session.
- **One permission dialog** for every rule that asks about a call, with *Yes*, *No*, and *Allow for this session*.
- **Subagents** have no screen to ask on: a call that needs your approval is refused, and the agent is told to bring it
  back to you.

### Analytics

A local SQLite index of your MyPi sessions, read from pi's session files: model usage and cost, cache share, tool
calls and failures (with commands that only exited non-zero counted apart), shell commands that have no tool yet, code
navigation, the done check and subagent runs, and permission dialogs. `/analytics` shows the last 7 days and
`/analytics all` everything; the agent reads the same report through its `analytics` tool. Nothing leaves your machine,
and no prompts, replies, or file contents are stored.

### Worktrees

`/worktree enter <name>` creates a git worktree if it's new and moves the conversation into it; `/worktree exit` comes
back and keeps or removes it. `/worktree list` and `/worktree remove <name>` manage them.

### It knows itself

Ask the agent who it is and it answers as MyPi, on the model it's running. Ask it to improve itself and it goes
straight to MyPi's roadmap and docs, from any folder.

## Commands

| Command | What it does |
|---|---|
| `/plan [plan\|build]` | Toggle Plan and Build, or pick one |
| `/plan implement [file]` | Implement a plan in a fresh Build session |
| `/agents` | List, view, create, edit, or delete agents |
| `/jobs` | View, open, or stop background jobs |
| `/worktree enter\|exit\|list\|remove` | Work in a git worktree |
| `/lsp [list]` | Turn language servers on or off |
| `/done-check` | Show the project's check commands and whether they're approved |
| `/onboard` | Learn this project and save memories for future sessions |
| `/memory-check` | Find broken `[[links]]` and invalid frontmatter in memories |
| `/analytics [all]` | Usage, tools, failures, and MyPi's features, for 7 days or all history |
| `/modules [list]` | Choose which modules load |

## Tools the model gets

On top of pi's own `read`, `edit`, `write`, `grep`, `find`, and `ls`:

| Tool | From | What it does |
|---|---|---|
| `bash` | core | pi's shell, plus `background: true` for long-running commands |
| `job_list`, `job_wait`, `job_stop` | core | Manage background jobs |
| `web_search` | core | Search the web; keyless, with fallback and rate-limit rests |
| `web_fetch` | core | Read a URL as markdown |
| `ask_user` | plan-build | Ask you a question with concrete choices |
| `submit_plan` | plan-build | Submit a plan for approval |
| `task_create`, `task_update`, `task_list`, `task_get` | todo | Track multi-step work |
| `lsp`, `lsp_edit` | lsp | Navigate and rename by symbol |
| `subagent`, `subagent_apply`, `agent_manage` | subagents | Delegate work, apply a writer's patch, manage agents |
| `analytics` | analytics | Read the analytics report |

## Modules

Every feature beyond the core is a module in `src/module/<name>/`, with a design doc in
[`docs/modules/`](docs/modules/README.md). `/modules` switches the optional ones on and off; the choice applies from
the next `/reload`.

| Module | Loads | What it does |
|---|---|---|
| [plan-build](docs/modules/plan-build.md) | always | Plan and Build modes, `ask_user`, `submit_plan`, the implement dialog |
| [subagents](docs/modules/subagents.md) | always | Built-in and your own agents, worktree writers, `/agents` |
| [memory](docs/modules/memory.md) | always | Project and global memories, `/onboard`, `/memory-check` |
| [todo](docs/modules/todo.md) | by default | Task tools and the checklist |
| [done-check](docs/modules/done-check.md) | by default | Checks changed files and runs approved commands when the agent stops |
| [lsp](docs/modules/lsp.md) | by default | Language servers, `lsp`, `lsp_edit`, `/lsp` |
| [context](docs/modules/context.md) | by default | Compaction summaries and clearing old tool results |
| [analytics](docs/modules/analytics.md) | by default | The local index, `/analytics`, and the `analytics` tool |

*Always* modules are part of how MyPi works and can't be switched off; the others load by default and can be.

## Configuration

### Keys for web search

`web_search` works without keys. A key only raises a service's limits. Set any of these in your shell before starting
pi:

| Variable | Service | Sent as |
|---|---|---|
| `PARALLEL_API_KEY` | Parallel | `Authorization: Bearer …` |
| `EXA_API_KEY` | Exa | `x-api-key` |
| `TINYFISH_API_KEY` | TinyFish | `X-API-Key` (instead of its keyless mode) |
| `TAVILY_API_KEY` | Tavily | `Authorization: Bearer …`; Tavily is used only with a key |

MyPi never stores a key: the header names the variable, and pi reads it when it connects. To configure a server
differently, add a full entry with the same name (`parallel`, `exa`, `tinyfish`, `tavily`) to `~/.pi/agent/mcp.json`;
it replaces MyPi's. See [MCP servers](docs/mcp/README.md).

### Project files

| File | Purpose |
|---|---|
| `.pi/done-check.json` | `{ "commands": [...] }`: the checks the done check runs, after you approve them |
| `.pi/agents/*.md` | The project's own agents, loaded in trusted projects |
| `AGENTS.md` | Project instructions; pi puts it in the agent's context |

## Where things are kept

| What | Where | In git |
|---|---|---|
| Plans | `.pi/plans/` in the project | No: MyPi git-ignores it |
| Project memories | `.pi/memories/` in the project | No: MyPi git-ignores it |
| Writer worktrees and patches | under `.pi/` in the project | No |
| Global memories | `~/.pi/agent/memories/` | — |
| Your agents | `~/.pi/agent/agents/` | — |
| Approved check commands | `~/.pi/agent/done-check/` | — |
| Analytics | `~/.pi/agent/analytics/analytics.sqlite` | — |

Everything stays on your machine. Delete the analytics folder to start its history over.

## Develop

| Script | What it does |
|---|---|
| `npm run check` | Typecheck, lint, and test with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | Biome, optionally writing fixes |
| `npm test` / `test:cov` | vitest, optionally with coverage |

Start with [`AGENTS.md`](AGENTS.md) (the map and the rules) and [`docs/principles.md`](docs/principles.md) (how MyPi
is designed and written). Then:

- [architecture](docs/architecture.md): how the parts fit together;
- [project structure](docs/project-structure.md): where new things go;
- [modules](docs/modules/README.md), [tools](docs/tools/README.md), and [rules](docs/rules/README.md): one doc per
  part, with its design and status;
- [roadmap](docs/roadmap.md): what's next and why.

New features start as a doc and a plan, are built in small checkpoints with a test for each rule, and are checked live
in a real pi session before they're done. Much of MyPi was built by pi running MyPi.

## License

MIT
