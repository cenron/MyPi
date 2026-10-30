# Architecture

## How pi loads MyPi

MyPi is a pi package. The global settings file, `~/.pi/agent/settings.json`, lists it under `packages`, so every pi
session loads it regardless of the working directory. The repository sits beside the agent directory, not inside it, so
credentials and sessions stay out of git.

Pi reads the `pi` manifest in `package.json` to find resources:

| Manifest key | Path                        | Loaded as                                          |
|--------------|-----------------------------|----------------------------------------------------|
| `extensions` | `./index.ts`                | One extension, loaded through jiti. No build step. |
| `skills`     | `./resources/skills`        | Skill directories, available as `/skill:<name>`    |
| `prompts`    | `./resources/prompts/*.md`  | Prompt templates, available as slash commands      |
| `themes`     | `./resources/themes/*.json` | Themes                                             |

Pi supplies the host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`,
`typebox`) at runtime. MyPi declares them as peers so it never ships a second copy.

## Startup flow

```
index.ts               default factory: new MyPi(pi), then pi.on("session_start" | "before_agent_start" | "tool_call" | "session_shutdown", …)
└─ src/mypi.ts         MyPi.onSessionStart(ev, ctx)
   ├─ await new Worktrees(ctx.cwd).project()     main checkout and git common folder; a git failure warns and leaves none
   ├─ new Session(ctx, pi, project)              src/core/session.ts: readonly project and per-session services
   ├─ registerRules(session.toolGuard)          src/rule/index.ts: core rules, before module loading
   ├─ loadModules(session, ev.reason)            src/module/index.ts: new each module, moduleManager.start() picks the running ones
   ├─ registerTools(pi, session)                 src/tool/index.ts: the built-in tools + the running modules'
   ├─ initTools(tools)                           init() on the built-in tools that have one
   ├─ moduleManager.init()                       init() on the running modules, now that their tools exist
   ├─ registerCommands(pi, session)               src/command/index.ts: MyPi's commands + the running modules
   └─ registerMcpServers(pi, session)            src/mcp/index.ts: MyPi's MCP servers, connected by pi
   MyPi.onBeforeAgentStart(ev)                   before every run: promptManager.apply(ev.systemPromptOptions.sections)
   MyPi.onToolCall(ev, ctx)                      before every tool call: returns toolGuard.check(ev, ctx) to pi
   MyPi.onSessionEnd(ev, ctx)                    session_shutdown: session.jobs.stopAll(), then shutdownTools(tools, session)
```

`index.ts` at the repo root is the single extension entry point. It creates the `MyPi` object and routes pi events to
its methods. It holds no logic.

`MyPi` (`src/mypi.ts`) owns the event handlers. On `session_start` it resolves the project, passes it to `new Session(ctx, pi, project)`,
keeps the session, installs the core rules, and picks the modules to load. Discovery failures warn once and leave no project. It
registers the tools (the built-ins and the modules'), runs the modules' `init()`,
registers the commands, its own and the modules', and registers MyPi's MCP servers. Tools come before `init()` because
a module's `init()` may turn its tools on with `setActiveTools`, and pi ignores names that aren't registered yet
("Unknown and hidden tool names are ignored", `setActiveToolsByName` in `dist/core/agent-session.js`). On `before_agent_start` it writes
the modules' prompt sections (see `PromptManager` below), and on `tool_call` it returns the `ToolGuard`'s result.

Each extension instance sees exactly one `session_start`. New, resume, fork, and `/reload` tear the extension down and
load it fresh (`agent-session-runtime.js` builds new services for each session, and `AgentSession.reload` replaces the
extension runner). So `MyPi`, its `Session`, and its modules all live for one session, and handlers registered during
`session_start` never stack up.

## Core

`src/core/` holds the services every part of MyPi shares, imported as `#core/<file>`.

- **`Session`** wraps the `ExtensionContext` from `session_start` and the `ExtensionAPI`. It's the handle passed to
  commands and modules. It logs through `log`, `logWarning`, and `logError`, keeps state in the session through `save`
  and `load`, and owns the session's `ModuleManager` as `moduleManager`, plus the shared `footer`, `editor`, and
  `promptManager`, `toolGuard`, and `renderers` (the modules' tool renderer chain). `worktrees` is the git worktree service (`/worktree` and subagent writer worktrees;
  see [worktree](tools/worktree.md#the-service) and [subagents](modules/subagents.md)). `project` is the repository's
  main checkout and git common folder, or
  undefined outside git or when git fails: `MyPi` resolves it once before modules load and passes it in, so module
  `init()` stays synchronous. Memory and plan-build keep their folders in the main checkout through it.
- **Saved state.** `session.save(name, data)` writes a `mypi-<name>` custom entry with `pi.appendEntry`, which pi keeps
  out of the model's context. `session.load(name)` returns the data of the last `mypi-<name>` entry on the current
  branch (`ctx.sessionManager.getBranch()`), or `undefined`, typed `unknown` because the file can hold anything. This is
  the low-level pair: core uses it directly (`ModuleManager` saves `mypi-modules`), and modules use the typed
  `saveState`/`loadState` on `BaseModule` instead (see [Modules](#modules)). `session.saveTo(sessionManager, name,
  data)` writes the same entry into another session, such as a new one in `ctx.newSession({ setup })`, which runs
  before that session's `session_start`, so its modules see the entry in `init()`.
- **`ModuleManager`** (`module-manager.ts`) holds the session's module instances and two sets of names: `running`,
  decided on `session_start` and fixed until `/reload`, and `selected`, what `/modules` saved for the next `/reload`.
  `start(modules, reason)` reads the saved selection and picks the modules to load; `init()` then runs their
  `init()`, once `registerTools` has run. `getCommands()` and `getTools()` return the running modules' commands and
  tools. `select(names)` changes only `selected` and saves it.
  `moduleInfos` returns a copy of each `info` with `isLoaded` (running) and `isSelected` set. A module's `info` getter
  can build a new object on every call, so the flags live in the manager, never on `module.info`.
- **`pickLoaded(reason, saved, modules)`**, a private `ModuleManager` method, is the only place the load rule is
  written. `start` and `select` both use it. Tests reach it through them, with the fake session and modules in
  `test/fakes.ts`. See [Module loading](#module-loading).
- **`Session.notify`** (private) sends those messages to `ctx.ui.notify` and skips them when `ctx.hasUI` is false (print and JSON
  modes).
- **`RendererChain`** (`tool-renderers.ts`) holds one tool renderer resolver per module, keyed by `info.name`, and is
  `session.renderers`. Modules set theirs with `BaseModule.onToolRender(resolver)`. pi can't unregister a resolver, so
  `MyPi` registers one, once per extension load, that asks the current session's chain: resolvers in the order set,
  each wrapping the ones after it, then pi's own. A reload redraws the transcript from `rebuildChatFromMessages`
  before it emits `session_start`, so the resolver runs with no session yet and hands those rows to `next()`, pi's
  own renderers; rows drawn then keep pi's look until the session ends. Quiet is the first user; a layout theme (the
  roadmap's Theme picker) is the next.
- **`PromptManager`** (`prompt-manager.ts`) holds one system prompt section per module, keyed by `info.name`, and is
  `session.promptManager`. Modules set theirs with `BaseModule.setPrompt(text)`; `undefined` clears it. Core sets one
  of its own, `identity` ([identity](core/identity.md)), from `MyPi` on every run. `apply(sections)`
  writes each as `mypi-<name>` into `event.systemPromptOptions.sections`, and `MyPi` calls it on every
  `before_agent_start`, user and custom runs alike. How pi uses the sections:
  - Each run's sections start empty (pi copies its base options per run), so they're written every run, not on change.
    A run that skipped them would make pi remove the section, then add it back on the next run.
  - Pi wraps each section as `<name>…</name>`, rebuilds the prompt, and diffs it against the sections the transcript
    already has. A changed section goes out as an `Updated system prompt section "<name>"` system message before the
    prompt; an unchanged one sends nothing; a missing one sends `Removed system prompt section "<name>"`
    (`diffSystemPromptSections` in `dist/core/system-prompt.js`, `_prepareRun` in `dist/core/agent-session.js`).
  - The earlier request stays byte-identical, so the cache stays warm, but only on models whose
    `compat.supportsMidConvoSystemMessages` is set (in pi 1.2.0: claude-opus-4-8 and the 5.x Claude models, gpt-5.4 and
    later). Other models get the change folded into the leading prompt: one cache miss per change.
  - The sections are fixed for a whole run, so a change made mid-run reaches the model on the next prompt.
  - Pi rejects names outside `^[a-z][a-z0-9_-]*$` when it builds the prompt, outside the handler's try/catch, so a bad
    name fails every prompt. Module names already fit.
- **`ToolGuard`** (`tool-guard.ts`) lets modules, and MyPi itself, object to tool calls. It's
  `session.toolGuard`, and modules add one rule each with `BaseModule.onToolCall(rule)`, keyed by `info.name`.
  `MyPi.onToolCall` is MyPi's only `tool_call` handler and hands each call to the guard.
  - **MyPi's own rules** live in `src/rule/` (`#rule/<file>`), next to `src/command/` and `src/tool/`, one file each,
    each a class extending `BaseRule` (`rule/base.ts`): an
    `info` getter (`name`, `description`) and `check(call, env)`, like a module's `info`. They're listed in
    `createRules` (`rule/index.ts`); `registerRules(guard)` sets each on the guard under `info.name` on every
    `session_start`, before the modules load, so they're always on. A subagent's child sets them on its own guard
    the same way ([subagents](modules/subagents.md#access-and-plan-mode)). Every rule shares the session's one
    `PromptPaths`, which `registerRules` creates and returns to `MyPi`: the skill folders and context files pi listed
    in the prompt. pi hands those over only in `before_agent_start`, so `MyPi.onBeforeAgentStart` calls
    `updatePromptPaths` (`rule/index.ts`), which fills them once; they change only on `/reload`, which starts over. The first rule is the [folder guard](rules/folder-guard.md)
    (`rule/folder.ts`). Their docs are in [`docs/rules/`](rules/README.md).
  - Modules also say what a read-only mode (Plan) may still let them write, with `BaseModule.setWritable({ dirs,
    tools })`, keyed by `info.name` like the rules. The guard merges every module's entry into the rule's `env` as
    `writableDirs` and `writableTools` on each call, so no rule holds a copy and module init order doesn't matter.
    Plan-build adds `.pi/plans/` and `submit_plan`, memory its two folders; neither knows about the other.
  - A rule is pure: `(call: { toolName, input, annotations? }, env: { cwd, home, writableDirs, writableTools }) =>
    Verdict`, where `Verdict` is
    `allow`, `block` with a `reason`, or `ask` with `questions`, each its own dialog line and its own "Allow for this
    session" (the folder guard asks one per path). A module reads its own state (plan-build's mode) in
    the closure. The guard fills `annotations` (`readOnlyHint`, `destructiveHint`, …) from `pi.getAllTools()`, so rules
    never touch pi; they're set by the tool's author (MCP tools carry them, pi's built-ins don't) and unverified.
  - A verdict is an objection, never a grant: `allow` means "no objection from me" and can't override another rule.
    The guard runs every rule, then any `block` wins (its reason goes to the model, nothing is asked), else any `ask`
    shows one dialog listing every question, else the call runs. Pi itself stops at the first block, so rules must be
    cheap and side-effect free to all run first.
  - Only the guard asks: `ctx.ui.select("Permission required\n<lines>", ["Yes", "No", "Allow for this session"], {
    signal: ctx.signal })`, one line per ask, `<module>: <question>`. Pi's own `confirm` is the same selector with Yes
    and No (`showExtensionConfirm` in `interactive-mode.js`), so the dialog looks the same plus the third choice. No,
    Esc, and an abort (select resolves `undefined`) block with `The user declined this call.` Without a UI an `ask`
    blocks. Modules never ask themselves, so dialogs don't stack and the `hasUI` check lives in one place.
  - Every dialog it shows, and every no-UI refusal, goes out on the bus's `approval` channel once its choice is
    known: the rules that asked (each named once), the choice (`yes`, `no`, `session`, `no-ui`), and the call's model
    and thinking level. No question text, since a question holds commands and paths; analytics records the notice
    ([analytics](modules/analytics.md)), breaking down choices per model and per rule.
  - A long ask is shortened for the dialog by `previewAsk`: at most 12 lines, each cut at 160 characters, with a note
    saying how much was left out and that Yes allows all of it. Without it, a command with a pasted page made the
    dialog taller than the terminal and hid its choices. The no-UI block reason gets the same short version. Approvals
    still match the full lines, so two long commands that start alike never share an "Allow for this session".
  - "Allow for this session" lives here too, without touching modules. Picking it lets the call run and remembers each
    listed ask line as an exact string in an in-memory `Set` on the guard. `Session` builds a new guard, so `/reload`,
    resume, and a new session forget it. Later asks whose line is remembered are skipped, the dialog lists only the
    rest, and with none left nothing is asked. Exact strings keep it safe (`npm install` asks after `npm test` was
    allowed), the module name keeps modules apart, and a remembered ask never overrides a block, since a block returns
    before the asks are looked at.
  - Rules don't change `input`, though pi allows it, so rule order never matters.
  - Each rule writes its own reason ("Plan mode is on: …"); the guard passes it through unchanged.
  - How pi runs `tool_call` (pi 1.2.0): the event is `{ toolName, toolCallId, parentToolCallId?, input }`, and
    `isToolCallEventType(name, ev)` narrows `input`. Handlers of every extension run in load order, and the first
    `{ block: true }` wins (`emitToolCall` in `dist/core/extensions/runner.js`). A block, or a handler that throws,
    becomes an error tool result whose text is `reason` (`prepareToolCall` in pi-agent-core's `agent-loop.js`). An
    inactive tool fails with `Tool X not found` before any hook runs. In a parallel batch each call is prepared, hook
    included, one after another before any runs, so dialogs never overlap. Calls a tool makes through
    `ctx.executeTool()` (codemode scripts, for example) pass through `tool_call` too, under the inner tool's name with
    `parentToolCallId` set (`_executeNestedToolCall` in `dist/core/agent-session.js`). They can reach the active
    `direct` tools plus every `codemode` or `deferred` tool, active or not, so the guard is the only gate for those.
  - Shared helpers for rules, in `util/`, all pure:
    - `shell.ts`: `tokenize(command)` splits a bash command into segments of unquoted words, each with the files its
      `<` redirects read, or returns `undefined`
      on syntax that can run or write something the words don't show (`$(`, backticks, `$'…'`, brace expansion,
      most redirects). `isReadOnlyCommand(command)` is an allowlist on top of it; plan-build's
      [Plan rule](modules/plan-build.md#plan-rule) lists what it allows. `paths.ts`'s `commandPaths`, the folder
      guard's bash check, reads the places a command names from it.
    - `walk.ts`: `fileTimes(root, extensions?)` times every file under a folder (skipping hidden folders and
      `node_modules`), and `fileChanges(before, after)` says what was created, changed, or deleted between two; lsp
      tracks its servers' files with them, and the done check a run's. `findSourceFile` finds the nearest file with
      given extensions.
    - `paths.ts`: `resolveToolPath(path, cwd, home)` mirrors pi's unexported `resolveToCwd`, the resolver `edit` and
      `write` use (`dist/utils/paths.js`), step for step: Unicode spaces to plain spaces, strip one leading `@`,
      expand `~` and `~/` (not `~user`), convert `file://` URLs, then resolve against `cwd`. A test compares it with
      pi's own function, so a pi upgrade that changes resolution fails there. `isInside(dir, path)` is a
      `path.relative` check, since `startsWith` lets `.pi/plans-evil/` through. It's true for `dir` itself, and it
      compares text only: a symlink under `dir` that points outside counts as inside. `tempFilePath(prefix, ext)` is
      a new random path in `os.tmpdir()` (`<prefix>-<16 hex><ext>`), for job logs and web_fetch's saved full text;
      create it with `flag: "wx"`.
- **The event bus** (`events.ts`): MyPi's messages between parts, over pi's own `pi.events` (a Node `EventEmitter`
  shared by every extension; pi drops an extension's listeners on `/reload`). `publish`/`subscribe` carry notices;
  `ask`/`answer` carry questions every listener answers, gathered because `emit` calls every listener before it
  returns (a test pins that). Channels go out as `mypi:<name>`; `MyPiNotices` and `MyPiQuestions` list every one, with
  who publishes or asks and who listens or answers. Modules use `BaseModule`'s `publish`, `subscribe`, `ask`, and
  `answer`; core calls the functions with `session.pi.events`. For messages between parts that core doesn't combine;
  the services below stay services. See [done check](modules/done-check.md#the-event-bus).
  - **`channels.ts`** holds the contracts: `MyPiNotices`, `MyPiQuestions`, and what they carry (`Problem`, `Duplicate`,
    `OpenTask`, and `Approval`), each naming who publishes or asks and who listens or answers. `events.ts` is only the mechanism and
    never changes for a feature.
  - **Deleting a part that owns a channel:** delete its folder, then remove the channels only it asks or publishes
    from `channels.ts`. Every `ask`, `answer`, `publish`, and `subscribe` left on them fails the typecheck, which
    lists what to delete in the other parts (for the done check's channels: `mode` in plan-build, `diagnostics` in
    lsp's `problems.ts` and `duplicate-check.ts`, and `openTasks` if todo is removed; `checkCommands` in subagents if the done check is removed). The bus's own tests use the current channels, so they
    change with them.
- **`JobManager`** (`job-manager.ts`) is `session.jobs`: long-running work that goes on after the tool call that
  started it. A job is a `JobSpec` (`kind`, `label`, `run(signal, write)`; in `types.ts` with `JobInfo` and
  `JobStatus`); `start` gives it an id counting up from 1, a log file (`pi-job-<hex>.log` in `os.tmpdir()`, `0600`,
  kept after it ends), and a 50K-character tail in memory, and records how it ended: `completed`, `failed` (an exit
  code or a thrown error), or `stopped`. It publishes the running count on the bus's `jobs` channel on every start and
  end; `Session` listens to update the below-editor jobs line, and `stopAll()` stops publishing. Generic on purpose: shell
  commands are one kind (`shellJob` in `src/tool/bash/`, through pi's own `createLocalBashOperations().exec`, which
  kills the process tree on abort), and subagent runs are a second. Every kind's end goes through `noticeOnEnd` in
  `src/core/job-notice.ts`, which also feeds `job_wait` and the subagents' grouped completions. `MyPi.onSessionEnd` calls `stopAll()` before the
  tools' shutdown. See [background process](tools/background-process.md).
- **`MessageType`** is a const object plus a type of the same name: the values are `"info" | "warning" | "error"`,
  derived from the object, and match pi's `notify` signature. It generates no runtime code beyond the object, unlike
  `enum`.
- **`types.ts`** holds the types shared across folders: `Command`, `ModuleInfo`, `ModuleLoadMode` (a const object plus
  a type, the same pattern as `MessageType`), the module contract, `Module` and `ModuleClass`, and the job types,
  `JobSpec`, `JobInfo`, and `Job`. Its `CommandInfo`, `CommandExec`, and `JobStatus` types stay local to that file.
- **`util/errors.ts`** has `errorMessage` (any thrown value to a string) and `isNodeError` (narrows to
  `NodeJS.ErrnoException`).
- **`util/guards.ts`** has `isRecord` (a plain object, before reading fields off JSON) and `isNonEmptyString`.
- **`util/git.ts`** has `keepOutOfGit(dir)`: a `.gitignore` of `*` in a folder MyPi writes into, written with `wx`
  so an edited one is kept. Used by plan-build's `.pi/plans/`, memory's `.pi/memories/`, and worktree storage.

## Commands

`src/command/` implements slash commands.

- A command is a `Command` (`src/core/types.ts`): `{ info: { name, description }, execute(ctx, args: string[]) }`.
  `ctx` is pi's `ExtensionCommandContext` for this run, which has `ui.custom`, `mode`, and later `reload()`.
  `execute` returns a string (or a promise of one) to show, or `undefined` to show nothing.
- `registerCommands(pi, session)` registers everything returned by `createCommands(session)`, then
  `session.moduleManager.getCommands()`: the commands of running modules only, so an unloaded module's commands don't
  exist.
- `runCommand` wraps every handler. It splits the raw argument string on whitespace, shows the returned string as an
  `info` notification, and turns a thrown error into an `error` notification. Commands don't need their own try/catch.

A module's commands live in its own folder, `src/module/<name>/commands/<command>/`, with the command in `index.ts`
and files only it uses beside it (plan-build's `/plan` is `commands/plan/`, with `implement.ts`). The module returns
them from `commands()`.

To add a command, create `src/command/<name>.ts` exporting a function that takes the `Session` and returns a `Command`,
then add it to the list in `createCommands`. A command that needs more than one file gets a folder,
`src/command/<name>/`, with the command in `index.ts`. `/modules` opens the module modal and `/modules list` prints
each module as `loaded: <name>` or `not loaded: <name>`; see [Module loading](#module-loading).

## Tools

`src/tool/` holds MyPi's built-in tools: general tools that belong to no module, each with a doc in
`docs/tools/<name>.md` (index: `docs/tools/README.md`). It mirrors `src/command/`.

- A built-in tool is a `Tool` (`src/tool/types.ts`): `{ definition, init?, shutdown? }`. A tool file exports a function
  that takes the `Session` and returns one, with `definition` built by `defineTool({ name, label, description,
  parameters, execute, … })` (`src/tool/web-fetch/index.ts`). A module's tools are `defineTool` definitions too,
  without the hooks; the module's own `init()` covers their setup.
- **Hooks**, for tools that keep state or resources across calls:
  - `init()` runs on `session_start`, after every tool is registered and before the modules' `init()`. Rebuild state
    from the branch here (todo). A `session_start` handler added now would miss this session: pi copies the handler
    list before dispatching (`snapshotEventHandlers` in `dist/core/extensions/runner.js`). Later events, such as
    `session_tree`, can be subscribed from `init()` with `session.pi.on`.
  - `shutdown()` runs on `session_shutdown`, which `/reload`, a session switch, and quit all reach, so it must be
    idempotent (background process kills its children here). `shutdownTools` logs a `shutdown()` that throws and goes
    on, so one tool's failure doesn't leave another's processes running.
  - `MyPi` keeps the list `registerTools` returns and runs the hooks through `initTools` and `shutdownTools`.
- `defineTool` (exported by pi) does nothing at runtime. It keeps the types: `execute`'s arguments are inferred from
  the TypeBox `parameters`, and the result, `ToolDefinition<TParams, TDetails> & ToolDefinition<any, any, any>`, fits
  in a plain `ToolDefinition[]`. Without it a list rejects a tool (`renderCall`'s arguments don't match), and a tool
  returned as a bare `ToolDefinition` gets `any` arguments, which tsc doesn't flag. Commands need nothing like it: every
  `Command` has the same type, because each one parses its own `string[]`, while pi parses a tool's arguments from its
  schema, so each tool's `execute` has its own type.
- `registerTools(pi, session)` registers the definitions of everything returned by `createTools(session)`, then
  `session.moduleManager.getTools()`: the tools of running modules only. It returns the built-in tools. It runs on `session_start`, before the
  modules' `init()` (see [Startup flow](#startup-flow)).
- pi turns an error thrown in `execute` into an error result for the model, so there's no wrapper like `runCommand`.
- Tools can't be unregistered (only withdrawn by registering again with `exposure: "hidden"`). As with commands, a
  tool that isn't registered on the next `session_start` is gone after `/reload`.
- Set `annotations` truthfully: `ToolGuard` and the Plan rule (`src/core/plan-rule.ts`) read `readOnlyHint`.
- A renderer returns `reuseText(context.lastComponent, text)` (`src/ui/render.ts`): one `Text` per slot, reused
  across redraws, as pi's own tools do.
- **Overriding a pi tool:** a tool registered with a built-in's name replaces it. `bash` (`src/tool/bash/`) builds pi's
  own with `createBashToolDefinition`, spreads it to keep its prompt text and `outputSchema`, adds its own parameters,
  and hands the calls it doesn't handle to pi's `execute`. pi's tool definitions carry no renderers: pi draws its
  built-in tools by name (`withBuiltInRenderers`) whenever the definition supplies none, so an override that sets
  `renderCall` replaces the drawing of every call. To change only some calls, register a resolver with
  `pi.registerToolRenderer((toolName, next) => …)` that delegates to `next()` (`backgroundRenderer`, registered once
  in `MyPi`'s constructor, since pi keeps resolvers in a list). A tool that declares an `outputSchema` must set
  `structuredContent` on every successful result; codemode scripts read it instead of the text.
- A tool that sends custom messages registers their renderer from `init()` with `session.pi.registerMessageRenderer`
  (`bash`'s job notices, `mypi-job`); pi accepts it during `session_start` and looks renderers up when it draws.

To add a tool, create `src/tool/<name>.ts` (or a folder, `src/tool/<name>/index.ts`, once it needs more than one
file), then add it to the list in `createTools`. A module's tools live in `src/module/<name>/tools/` and are returned
from its `tools()`.

## MCP servers

`src/mcp/` holds the MCP servers MyPi registers with pi out of the box, documented in
[`docs/mcp/README.md`](mcp/README.md). MyPi has no MCP client: pi's built-in MCP extension connects the servers.

- A server is a `McpServer` (`src/mcp/types.ts`): `{ name, config }`, where `config` is pi's `McpServerConfig`, the
  shape of an `mcp.json` entry. Each server is a function in its own file (`src/mcp/parallel.ts`, `src/mcp/exa.ts`),
  which adds a key header when its variable is set.
- `registerMcpServers(pi, session)` registers everything `createMcpServers()` lists with `pi.registerMcpServer`, last
  in `MyPi.onSessionStart`. Pi throws for an invalid config or a name another extension owns; each call has its own
  try/catch, so a rejected server is logged (`MCP server <name>: <message>`) and doesn't stop the session starting.
- Order doesn't matter: pi's MCP extension reads servers registered before its `session_start` there, and connects
  later ones from its `mcp_servers_change` handler.
- Nothing is unregistered. The registry belongs to the extension runtime, and `/reload` builds a new one, so a server
  MyPi stops listing is gone after `/reload` (checked live).
- Server tools are `mcp__<server>__<tool>`, reached as the server's `exposure` says. Their annotations reach
  `ToolGuard` through `pi.getAllTools()`, like any tool's.

To add a server, create `src/mcp/<name>.ts` exporting a `McpServer`, then add it to the list in `createMcpServers`.

## Modules

Feature modules live in `src/module/<name>/`, each with a design doc in `docs/modules/<name>.md`. A module's `index.ts`
is its public surface: a class that extends `BaseModule` (`src/module/base.ts`), which implements `Module`
(`src/core/types.ts`).

```ts
export type ModuleClass = new (session: Session) => Module;

export interface Module {
  readonly session: Session;
  get info(): ModuleInfo;  // name, description, command infos, loadType
  init(): void;            // register event handlers, turn tools on or off, restore state
  commands(): Command[];   // registered through registerCommands, wrapped by runCommand
  tools(): ToolDefinition[]; // registered through registerTools, before init()
}
```

- `ModuleClass` is the constructor type, so every module is built the same way: `new Module(session)`.
- **`BaseModule<State>`** is the module SDK: a module owns everything about itself, including its saved state, and
  core never lists it. It gives defaults for `init()` (nothing), `commands()` (none), and `tools()` (none), so a module only writes what it
  uses, and `info` is the one thing it must provide. `State` is the module's own state type, declared in its folder
  (`class PlanBuildModule extends BaseModule<{ mode: Mode }>`). The protected `saveState(state)` and `loadState()`
  store it as `mypi-module-<info.name>`, typed by `State`, so saving the wrong shape doesn't compile. The `module-`
  prefix keeps modules apart from core's own entries, even for a module named `modules`. `saveStateTo(sessionManager,
  state)` saves it into another session (plan-build starts `/plan implement`'s new session in Build this way).
  `loadState` trusts the file, so check any field you rely on. The helpers `setFooter(item)`, `onKey(key, handler)`, `setPrompt(text)`,
  `onToolCall(rule)`, and `onToolRender(resolver)` each give the module one slot keyed by `info.name`: a footer item, a
  key handler, a prompt section, a `ToolGuard` rule, and a tool renderer resolver. A module returns its tools from `tools()`, wrapping each in `defineTool` (see [Tools](#tools));
  `tools()` runs before `init()`, so a tool reads module state in `execute`, not when it's built. `setToolActive(name, active)` adds
  one tool to pi's active tools or removes it, leaving the rest alone (and doing nothing when it's already in that
  state), since pi restores the active tools from the transcript. Add helpers here when a module first needs them (event handlers, tools), so the SDK only
  holds what's used.
- `Module`, `ModuleInfo` and `ModuleLoadMode` live in `src/core/types.ts`. `loadType` is `ON_LOAD` (loaded by default),
  `ON_DEMAND` (loaded only when chosen in `/modules`), or `ALWAYS` (loaded on every `session_start` and can't be
  unloaded). `pickLoaded` always picks `ALWAYS` modules, `select` always keeps them, and the modal shows their row
  locked (see [Module loading](#module-loading)).
- `src/module/index.ts` lists the module classes. `loadModules(session, reason)` builds each one and hands them to
  `session.moduleManager.start(modules, reason)`, which picks the ones to load. `registerTools` reads their tools from
  the manager, `moduleManager.init()` runs their `init()`, and `registerCommands` then reads their commands.
- A module reaches pi through `session.pi` and `session.ctx`, keeps its runtime state as fields, and saves what must
  survive `/reload` with `saveState`. Modules don't reach for globals or import each other's internals.
- A module that needs a pi event MyPi doesn't route subscribes in `init()` with `session.pi.on(event, handler)`
  (plan-build's `before_agent_start` and `agent_settled`). The set of running modules is fixed until `/reload`, which
  builds a new extension instance, so there's nothing to unsubscribe. Handlers run after MyPi's own, which `index.ts`
  registers at load.

To add a module, create `src/module/<name>/index.ts` with a class extending `BaseModule`, then add the class to the
list in `src/module/index.ts`.

## UI components

`src/ui/components/` holds reusable TUI components, imported as `#ui/components/<file>`. They implement pi-tui's
`Component` (`render`, `invalidate`, `handleInput`) and know nothing about MyPi features. A feature's UI lives in
`src/ui/` and builds on them. `src/ui/modules-modal.ts` is the example: `openModulesModal(ctx, session)` refuses
outside TUI mode, calls `openToggleDialog(ctx, title, items)`, and maps the saved ids back to its result, so the command
only formats what comes back. `/lsp` shares the same centered toggle dialog.

- **`Dialog`** draws a titled, rounded border around a padded background. A title too long for the width is cut with
  `truncateToWidth` and ends in `…`, so the top border never grows past `width`. `addChild` puts components inside the
  frame. It has no keys of its own: pi-tui sends each key only to the component `ctx.ui.custom` returned, and a
  `Container` doesn't route input, so `Dialog.handleInput` passes every key to every child.
- **`ToggleList`** wraps pi-tui's `SettingsList` as an on/off list: a green `●` (`theme.fg("success")`) or a grey `○`
  (`theme.fg("dim")`). Callers get `onToggle(id, on)` and never see the ANSI value strings. Passing `onAccept` adds a
  Save row, and `onCancel` runs on Escape. An item with `disabled: true` is locked: its row has one value, so Space or
  Enter can't change it, `onToggle` never fires for it, and its label is dim. The dim comes
  from overriding `label` in the `SettingsList` theme. `SettingsList` pads every label to the longest before styling
  it (`settings-list.js`), so the override matches on `text.trimEnd()`.

- **`openToggleDialog(ctx, title, items)`** opens a `ToggleList` in a `Dialog` as a centered overlay and resolves to
  the ids that are on at Save, or `undefined` on Escape. Toggles change a local copy until Save. `/modules` and `/lsp`
  use it.
- **`selectListTheme(theme)`**, next to `Dialog`, is the theme for pi-tui's `SelectList` in a dialog (accent for the
  selected row, dim for the rest), with `DIALOG_LIST_ROWS` for its height. `/jobs` and `/agents` use both.

Keys follow pi's own `SettingsList` screens, so MyPi feels like pi: Enter or Space changes a row, Escape cancels. When
changes have to be saved or discarded, the list gets an Apply row, like pi's theme picker (`settings-selector.js`): a
row with one value, so activating it still fires `onChange`. `SettingsList` hard-codes its hint ("Enter/Space to change
· Esc to cancel"), so don't give its keys other meanings.

Pi-tui re-renders right after every key it delivers, so a component doesn't call `tui.requestRender()` from
`handleInput`. `getSettingsListTheme()` reads pi's global theme, so tests that build a `ToggleList` call
`initTheme("dark")` first.

## Module loading

**Status:** done. The modal with locked rows for `ALWAYS` modules, the saved selection, restoring it on `reload`, and
registering only running modules' commands all work.

Which modules are loaded is decided once, on `session_start`. Loading and unloading go through `/reload`: `/modules`
saves the set you want, and the next `/reload` builds MyPi again with that set.

### Behavior

- On `session_start`, the event's `reason` picks the set:

  | `reason`                           | Loaded modules                                                                   |
  |------------------------------------|----------------------------------------------------------------------------------|
  | `reload`                           | Every `ALWAYS` module, plus the last saved set, or the defaults if there is none |
  | `startup`, `new`, `resume`, `fork` | The defaults: every `ALWAYS` and `ON_LOAD` module. `ON_DEMAND` modules stay off. |

  `startup` covers every session pi opens at launch, including `pi --continue`, so a reopened session starts from the
  defaults even though its saved set is still in the file.
- Only loaded modules run `init()` and get their commands registered. An unloaded module's commands don't exist.
- An `ALWAYS` module loads whatever the `reason` or the saved set says, and can't be switched off. It is for modules
  the rest of MyPi depends on.
- `/modules` opens a modal listing every module: a green `●` when loaded, a grey `○` when not, and a Save row last. Up
  and down move through the list, wrapping at the ends. Space or Enter toggles the selected module. Enter on Save saves
  the set and closes the modal. Escape closes it and discards the changes. An `ALWAYS` module's row is locked: a dim
  `<name>` with a `●` that Space or Enter doesn't change, so the list still shows everything that's running.
- Toggling changes nothing outside the modal. Save stores the new set as the selection and warns "Run /reload to apply
  the module selection:", followed by the selected names. It also writes the selection to the session, so the next
  `/reload` runs it. What's running doesn't change until then.
- Reopening the modal after a Save starts from the selection, not from what's running.
- `/modules list` prints each module as `loaded: <name>` or `not loaded: <name>`, from what's running.
- The saved set belongs to the session. Running `/new` instead of `/reload` drops the change, because the new session
  starts from the defaults.

### Design in pi

| Piece         | pi hook                                                                                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
|---------------|------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Saved set     | `pi.appendEntry("mypi-modules", { loaded: string[] })` on Save                                       | `ModuleManager.select` writes it with `session.save("modules", …)`, and `start` reads it on `reload` with `session.load("modules")`: the last `mypi-modules` custom entry in `ctx.sessionManager.getBranch()`, so a Save on a branch left with `/tree` isn't seen. Pi's `examples/extensions/tools.ts` restores its state the same way. Names that no longer match a module drop out, and a save that isn't `{ loaded: string[] }` falls back to the defaults. Write an array (`[...selected]`): pi saves entries with `JSON.stringify`, which writes a `Set` as `{}`. `pickLoaded` adds `ALWAYS` modules whatever the saved set says, so an old saved set can't drop one. Before the first prompt pi keeps entries in memory only, and `/reload` keeps the same `SessionManager`, so a reload still sees them. |
| Picking a set | `session_start` `event.reason`                                                                       | `MyPi.onSessionStart` passes `ev.reason` to `loadModules`, which calls `ModuleManager.start(modules, reason)`. `start` reads the saved set and passes it to `pickLoaded(reason, saved, infos)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Unregistering | `/reload`                                                                                            | Pi has no way to remove a command or tool. `registerCommands` writes to a private map. Reload throws the extension away, so commands not registered again are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Applying      | The user runs `/reload`                                                                              | `AgentSession.reload` keeps the session and its history, rebuilds the extension, and sends `session_start` with `reason: "reload"`. It refuses while the agent is responding or compacting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Modal         | `ctx.ui.custom<Set<string> \| undefined>(...)` as an overlay, with a `Dialog` holding a `ToggleList` | See [UI components](#ui-components). Save calls `done(names)` with a `Set` of the selected names in list order, Escape calls `done(undefined)`. The command passes it to `ModuleManager.select`. Only in `ctx.mode === "tui"`; other modes get an error notification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Save row      | A `SettingsList` row with a single value                                                             | Pi's theme picker (`settings-selector.js`) saves the same way, so `SettingsList`'s built-in hint stays true.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Locked row    | A `SettingsList` row with one value (`[●]`)                                                          | For `ALWAYS` modules: the modal passes `disabled: true` to `ToggleList`. The same one-value trick as the Save row, so the hint stays true, and `onChange` ignores disabled ids. The label is dimmed through a `label` override in the `SettingsList` theme, matched on `text.trimEnd()` because `SettingsList` pads labels; that override sees only text, so labels must be unique. `ToggleItem.disabled` keeps `ToggleList` generic.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Circles       | `theme.fg("success", "●")` and `theme.fg("dim", "○")`                                                | Both are `ThemeColor` names in pi 1.2.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### What the code needs

- **One place that knows what's loaded.** Done: `ModuleManager` keeps `running` and `selected` as name sets and sets
  `isLoaded` and `isSelected` on the copies `moduleInfos` returns. Read the flags from there, never from
  `module.info`.
- **`registerCommands` registers commands from running modules only.** Done, through `getCommands()`.
- Calling `ctx.reload()` from the modal could replace the manual step later. `Command.execute` already receives the
  `ExtensionCommandContext`, and the saved-set format stays the same.

### Slices

The UI comes first, then the wiring.

1. **Done.** The modal: list, circles, Space or Enter toggles, a Save row, Escape discards. It changes nothing outside
   itself and resolves to the selected names.
2. **Done.** The loaded flag, now `isLoaded` and `isSelected` from `ModuleManager.moduleInfos`.
3. **Done.** `pickLoaded`: `reason` + saved set + module list → names to load. Tested through `start` and `select`
   with fake modules, including an `ALWAYS` one, and a missing save (the defaults) versus an empty one (only `ALWAYS`).
4. **Done.** `start(modules, reason)` reads the last `mypi-modules` entry, and only running modules run `init()` and
   get their commands and tools registered. (Since 2026-10-21, `moduleManager.init()` runs `init()`, after the tools.)
5. **Done.** Save calls `ModuleManager.select`, which writes `{ loaded: [...selected] }` with `session.save`, and the
   command asks for `/reload`.
6. **Done.** Locked rows: `ToggleItem.disabled`, and the modal locks `ALWAYS` modules.

### Open questions

- Should the modal mark a module whose change waits on `/reload`? For now it shows the selection, and `/modules list`
  shows what's running. `moduleInfos` carries both flags, so a row can compare `isSelected` with `isLoaded`.

## Import aliases

Imports use Node subpath imports, declared under `imports` in `package.json`:

| Alias             | Resolves to             | Example                                           |
|-------------------|-------------------------|---------------------------------------------------|
| `#core/<file>`    | `src/core/<file>.ts`    | `import { Session } from "#core/session";`        |
| `#command/<file>` | `src/command/<file>.ts` | `import { modulesCmd } from "#command/modules";`  |
| `#tool/<file>`    | `src/tool/<file>.ts`    | `import { registerTools } from "#tool/index";`    |
| `#module/<file>`  | `src/module/<file>.ts`  | `import { loadModules } from "#module/index";`    |
| `#ui/<file>`      | `src/ui/<file>.ts`      | `import { Dialog } from "#ui/components/dialog";` |
| `#mcp/<file>`     | `src/mcp/<file>.ts`     | `import { registerMcpServers } from "#mcp/index";` |
| `#rule/<file>`    | `src/rule/<file>.ts`    | `import { registerRules } from "#rule/index";`     |

Each alias maps to a file, not a folder. Nested paths work too: `#core/util/errors` resolves to
`src/core/util/errors.ts`, and a module folder is `#module/<name>/index`. Inside a folder, use relative imports.

Leave `.ts` off import paths, relative ones included. `tsc` (`moduleResolution: "bundler"`), vitest and pi's jiti all
resolve extensionless paths; checked by loading `index.ts` through pi 1.2.0's own jiti. The `.ts` stays only in the
`imports` targets in `package.json`.

Use subpath imports rather than tsconfig `paths`. Pi loads extensions through jiti, and the Homebrew and npm builds
don't apply tsconfig `paths` (only pi's TypeScript-source runtime does). Subpath imports resolve the same way in pi,
`tsc`, and vitest. All of this was checked against pi 1.1.0. Biome sorts package imports before `#` aliases.

After changing `imports` in `package.json`, restart pi. `/reload` loads the extension again in the same process, which
keeps the old import map: in pi 1.2.0's jiti, a second load after an `imports` change still resolves the old target,
and only a new process sees the change. Edits to `.ts` files are picked up by `/reload`.

## Runtime lifecycle

- The extension factory only registers things: commands, tools, and event handlers. It doesn't start processes, timers,
  or watchers, because pi sometimes loads extensions without starting a session.
- Long-lived resources start in `session_start` and are released in an idempotent `session_shutdown` handler.
- `/reload` replaces the extension runtime. State in memory doesn't survive it; anything that must, such as the saved
  module set, goes in the session with `pi.appendEntry`.
- A session switch (`/new`, `/resume`, `/fork`) builds a new runtime too (`AgentSessionRuntime` in pi 1.2.0 calls its
  `createRuntime` again after `session_shutdown`), so handlers a module adds with `pi.on` in `init()` never stack. A
  module that owns processes releases them that way: lsp registers `session_shutdown` in `init()` to stop its
  language servers (and `tool_result` to report the agent's file changes to them), and starts them only on first
  use, not in `session_start`.

See the pi extension docs (`docs/extensions.md` in the installed package) for the event list and API.
