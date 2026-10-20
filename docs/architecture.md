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
   ├─ new Session(ctx, pi)                       src/core/session.ts: builds its ModuleManager, Footer, Editor, PromptManager
   ├─ loadModules(session, ev.reason)            src/module/index.ts: new each module, moduleManager.start()
   └─ registerCommand(pi, session)               src/command/index.ts: MyPi's commands + the running modules
   MyPi.onBeforeAgentStart(ev)                   before every run: promptManager.apply(ev.systemPromptOptions.sections)
   MyPi.onToolCall(ev, ctx)                      before every tool call: returns toolGuard.check(ev, ctx) to pi
```

`index.ts` at the repo root is the single extension entry point. It creates the `MyPi` object and routes pi events to
its methods. It holds no logic.

`MyPi` (`src/mypi.ts`) owns the event handlers. On `session_start` it builds a `Session` for that session's context,
keeps it, loads the modules, and registers the commands, its own and the modules'. On `before_agent_start` it writes
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
  `promptManager`, and `toolGuard`.
- **Saved state.** `session.save(name, data)` writes a `mypi-<name>` custom entry with `pi.appendEntry`, which pi keeps
  out of the model's context. `session.load(name)` returns the data of the last `mypi-<name>` entry on the current
  branch (`ctx.sessionManager.getBranch()`), or `undefined`, typed `unknown` because the file can hold anything. This is
  the low-level pair: core uses it directly (`ModuleManager` saves `mypi-modules`), and modules use the typed
  `saveState`/`loadState` on `BaseModule` instead (see [Modules](#modules)).
- **`ModuleManager`** (`module-manager.ts`) holds the session's module instances and two sets of names: `running`,
  decided on `session_start` and fixed until `/reload`, and `selected`, what `/modules` saved for the next `/reload`.
  `start(modules, reason)` reads the saved selection, picks the modules to load, and runs their `init()`.
  `getCommands()` returns the running modules' commands. `select(names)` changes only `selected` and saves it.
  `moduleInfos` returns a copy of each `info` with `isLoaded` (running) and `isSelected` set. A module's `info` getter
  can build a new object on every call, so the flags live in the manager, never on `module.info`.
- **`pickLoaded(reason, saved, modules)`**, a private `ModuleManager` method, is the only place the load rule is
  written. `start` and `select` both use it. Tests reach it through them, with the fake session and modules in
  `test/fakes.ts`. See [Module loading](#module-loading).
- **`Notifier`** sends those messages to `ctx.ui.notify` and skips them when `ctx.hasUI` is false (print and JSON
  modes).
- **`PromptManager`** (`prompt-manager.ts`) holds one system prompt section per module, keyed by `info.name`, and is
  `session.promptManager`. Modules set theirs with `BaseModule.setPrompt(text)`; `undefined` clears it. `apply(sections)`
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
- **`ToolGuard`** (`tool-guard.ts`) lets modules object to tool calls. It's
  `session.toolGuard`, and modules add one rule each with `BaseModule.onToolCall(rule)`, keyed by `info.name`.
  `MyPi.onToolCall` is MyPi's only `tool_call` handler and hands each call to the guard.
  - A rule is pure: `(call: { toolName, input, annotations? }, env: { cwd, home }) => Verdict`, where `Verdict` is
    `allow`, `block` with a `reason`, or `ask` with a `question`. A module reads its own state (plan-build's mode) in
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
    - `shell.ts`: `tokenize(command)` splits a bash command into segments of unquoted words, or returns `undefined`
      on syntax that can run or write something the words don't show (`$(`, backticks, `$'…'`, brace expansion,
      most redirects). `isReadOnlyCommand(command)` is an allowlist on top of it; plan-build's
      [Plan rule](modules/plan-build.md#plan-rule) lists what it allows.
    - `paths.ts`: `resolveToolPath(path, cwd, home)` mirrors pi's unexported `resolveToCwd`, the resolver `edit` and
      `write` use (`dist/utils/paths.js`), step for step: Unicode spaces to plain spaces, strip one leading `@`,
      expand `~` and `~/` (not `~user`), convert `file://` URLs, then resolve against `cwd`. A test compares it with
      pi's own function, so a pi upgrade that changes resolution fails there. `isInside(dir, path)` is a
      `path.relative` check, since `startsWith` lets `.pi/plans-evil/` through. It's true for `dir` itself, and it
      compares text only: a symlink under `dir` that points outside counts as inside.
- **`MessageType`** is a const object plus a type of the same name: the values are `"info" | "warning" | "error"`,
  derived from the object, and match pi's `notify` signature. It generates no runtime code beyond the object, unlike
  `enum`.
- **`types.ts`** holds the types shared across folders: `Command`, `CommandInfo`, `ModuleInfo`, `ModuleLoadMode` (a
  const object plus a type, the same pattern as `MessageType`), and the module contract, `Module` and `ModuleClass`.
  `CommandExec` is still in `src/command/types.ts`.
- **`util/errors.ts`** has `errorMessage` (any thrown value to a string) and `isNodeError` (narrows to
  `NodeJS.ErrnoException`).

## Commands

`src/command/` implements slash commands.

- A command is a `Command` (`src/core/types.ts`): `{ info: { name, description }, execute(ctx, args: string[]) }`.
  `ctx` is pi's `ExtensionCommandContext` for this run, which has `ui.custom`, `mode`, and later `reload()`.
  `execute` returns a string (or a promise of one) to show, or `undefined` to show nothing.
- `registerCommand(pi, session)` registers everything returned by `createCommand(session)`, then
  `session.moduleManager.getCommands()`: the commands of running modules only, so an unloaded module's commands don't
  exist.
- `runCommand` wraps every handler. It splits the raw argument string on whitespace, shows the returned string as an
  `info` notification, and turns a thrown error into an `error` notification. Commands don't need their own try/catch.

To add a command, create `src/command/<name>.ts` exporting a function that takes the `Session` and returns a `Command`,
then add it to the list in `createCommand`. A command that needs more than one file gets a folder,
`src/command/<name>/`, with the command in `index.ts`. `/myPi` is a placeholder showing the shape. `/modules` opens
the module modal and `/modules list` prints each module as `loaded: <name>` or `not loaded: <name>`; see
[Module loading](#module-loading).

## Modules

Feature modules live in `src/module/<name>/`, each with a design doc in `docs/modules/<name>.md`. A module's `index.ts`
is its public surface: a class that extends `BaseModule` (`src/module/base.ts`), which implements `Module`
(`src/core/types.ts`).

```ts
export type ModuleClass = new (session: Session) => Module;

export interface Module {
  readonly session: Session;
  get info(): ModuleInfo;  // name, description, command infos, loadType
  init(): void;            // register event handlers and tools, restore state
  commands(): Command[];   // registered through registerCommand, wrapped by runCommand
}
```

- `ModuleClass` is the constructor type, so every module is built the same way: `new Module(session)`.
- **`BaseModule<State>`** is the module SDK: a module owns everything about itself, including its saved state, and
  core never lists it. It gives defaults for `init()` (nothing) and `commands()` (none), so a module only writes what it
  uses, and `info` is the one thing it must provide. `State` is the module's own state type, declared in its folder
  (`class PlanBuildModule extends BaseModule<{ mode: Mode }>`). The protected `saveState(state)` and `loadState()`
  store it as `mypi-module-<info.name>`, typed by `State`, so saving the wrong shape doesn't compile. The `module-`
  prefix keeps modules apart from core's own entries, even for a module named `modules`. `loadState` trusts the file,
  so check any field you rely on. The helpers `setFooter(item)`, `onKey(key, handler)`, `setPrompt(text)`, and
  `onToolCall(rule)` each give the module one slot keyed by `info.name`: a footer item, a key handler, a prompt section,
  and a `ToolGuard` rule. `registerTool(def)` passes a tool to `pi.registerTool`, and `setToolActive(name, active)` adds
  one tool to pi's active tools or removes it, leaving the rest alone (and doing nothing when it's already in that
  state), since pi restores the active tools from the transcript. Add helpers here when a module first needs them (event handlers, tools), so the SDK only
  holds what's used.
- `Module`, `ModuleInfo` and `ModuleLoadMode` live in `src/core/types.ts`. `loadType` is `ON_LOAD` (loaded by default),
  `ON_DEMAND` (loaded only when chosen in `/modules`), or `ALWAYS` (loaded on every `session_start` and can't be
  unloaded). `pickLoaded` always picks `ALWAYS` modules, `select` always keeps them, and the modal shows their row
  locked (see [Module loading](#module-loading)).
- `src/module/index.ts` lists the module classes. `loadModules(session, reason)` builds each one and hands them to
  `session.moduleManager.start(modules, reason)`, which picks the ones to load and runs their `init()`.
  `registerCommand` then reads the commands from the manager.
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
outside TUI mode, calls `ctx.ui.custom`, and resolves to the result, so the command only formats what comes back. The
mode check lives with the UI, so every caller gets it.

- **`Dialog`** draws a titled, rounded border around a padded background. A title too long for the width is cut with
  `truncateToWidth` and ends in `…`, so the top border never grows past `width`. `addChild` puts components inside the
  frame. It has no keys of its own: pi-tui sends each key only to the component `ctx.ui.custom` returned, and a
  `Container` doesn't route input, so `Dialog.handleInput` passes every key to every child.
- **`ToggleList`** wraps pi-tui's `SettingsList` as an on/off list: a green `●` (`theme.fg("success")`) or a grey `○`
  (`theme.fg("dim")`). Callers get `onToggle(id, on)` and never see the ANSI value strings. Passing `onAccept` adds a
  Save row, and `onCancel` runs on Escape. An item with `disabled: true` is locked: its row has one value, so Space or
  Enter can't change it, `onToggle` never fires for it, and its label reads `<label> (locked)` in dim. The dim comes
  from overriding `label` in the `SettingsList` theme. `SettingsList` pads every label to the longest before styling
  it (`settings-list.js`), so the override matches on `text.trimEnd()`.

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
  `<name> (locked)` with a `●` that Space or Enter doesn't change, so the list still shows everything that's running.
- Toggling changes nothing outside the modal. Save stores the new set as the selection and warns "Need to /reload to
  enable/disable modules", followed by the selected names. It also writes the selection to the session, so the next
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
| Unregistering | `/reload`                                                                                            | Pi has no way to remove a command or tool. `registerCommand` writes to a private map. Reload throws the extension away, so commands not registered again are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Applying      | The user runs `/reload`                                                                              | `AgentSession.reload` keeps the session and its history, rebuilds the extension, and sends `session_start` with `reason: "reload"`. It refuses while the agent is responding or compacting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Modal         | `ctx.ui.custom<Set<string> \| undefined>(...)` as an overlay, with a `Dialog` holding a `ToggleList` | See [UI components](#ui-components). Save calls `done(names)` with a `Set` of the selected names in list order, Escape calls `done(undefined)`. The command passes it to `ModuleManager.select`. Only in `ctx.mode === "tui"`; other modes get an error notification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Save row      | A `SettingsList` row with a single value                                                             | Pi's theme picker (`settings-selector.js`) saves the same way, so `SettingsList`'s built-in hint stays true.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Locked row    | A `SettingsList` row with one value (`[●]`)                                                          | For `ALWAYS` modules: the modal passes `disabled: true` to `ToggleList`. The same one-value trick as the Save row, so the hint stays true, and `onChange` ignores disabled ids. The label gets ` (locked)` and is dimmed through a `label` override in the `SettingsList` theme, matched on `text.trimEnd()` because `SettingsList` pads labels. `ToggleItem.disabled` keeps `ToggleList` generic.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Circles       | `theme.fg("success", "●")` and `theme.fg("dim", "○")`                                                | Both are `ThemeColor` names in pi 1.2.0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### What the code needs

- **One place that knows what's loaded.** Done: `ModuleManager` keeps `running` and `selected` as name sets and sets
  `isLoaded` and `isSelected` on the copies `moduleInfos` returns. Read the flags from there, never from
  `module.info`.
- **`registerCommand` registers commands from running modules only.** Done, through `getCommands()`.
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
   get their commands registered.
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
| `#command/<file>` | `src/command/<file>.ts` | `import { myPiCmd } from "#command/mypi";`        |
| `#module/<file>`  | `src/module/<file>.ts`  | `import { loadModules } from "#module/index";`    |
| `#ui/<file>`      | `src/ui/<file>.ts`      | `import { Dialog } from "#ui/components/dialog";` |

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

See the pi extension docs (`docs/extensions.md` in the installed package) for the event list and API.
