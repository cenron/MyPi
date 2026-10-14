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
index.ts               default factory: new MyPi(pi), then pi.on("session_start" | "session_shutdown", …)
└─ src/mypi.ts         MyPi.onSessionStart(ev, ctx)
   ├─ new Session(ctx, pi)                       src/core/session.ts
   ├─ loadModules(session)                       src/module/index.ts: new each module, then init()
   └─ registerCommand(pi, session, modules)      src/command/index.ts
```

`index.ts` at the repo root is the single extension entry point. It creates the `MyPi` object and routes pi events to
its methods. It holds no logic.

`MyPi` (`src/mypi.ts`) owns the event handlers. On `session_start` it builds a `Session` for that session's context,
loads the modules, and registers the commands, its own and the modules'.

Each extension instance sees exactly one `session_start`. New, resume, fork, and `/reload` tear the extension down and
load it fresh (`agent-session-runtime.js` builds new services for each session, and `AgentSession.reload` replaces the
extension runner). So `MyPi`, its `Session`, and its modules all live for one session, and handlers registered during
`session_start` never stack up.

## Core

`src/core/` holds the services every part of MyPi shares, imported as `#core/<file>`.

- **`Session`** wraps the `ExtensionContext` from `session_start` and the `ExtensionAPI`. It's the handle passed to
  commands and modules. It logs through `log`, `logWarning`, and `logError`, and holds the `ModuleInfo` list in `modules`.
- **`Notifier`** sends those messages to `ctx.ui.notify` and skips them when `ctx.hasUI` is false (print and JSON
  modes).
- **`MessageType`** is a const object plus a type of the same name: the values are `"info" | "warning" | "error"`,
  derived from the object, and match pi's `notify` signature. It generates no runtime code beyond the object, unlike
  `enum`.
- **`types.ts`** holds the types shared across folders: `Command`, `CommandInfo`, `ModuleInfo`, and `ModuleLoadMode`
  (a const object plus a type, the same pattern as `MessageType`). `CommandExec` is still in `src/command/types.ts`.
- **`util/errors.ts`** has `errorMessage` (any thrown value to a string) and `isNodeError` (narrows to
  `NodeJS.ErrnoException`).

## Commands

`src/command/` implements slash commands.

- A command is a `Command` (`src/core/types.ts`): `{ info: { name, description }, execute(args: string[]) }`.
  `execute` returns a string (or a promise of one) to show, or `undefined` to show nothing.
- `registerCommand(pi, session, modules)` registers everything returned by `createCommand(session)`, then each
  module's `commands()`.
- `runCommand` wraps every handler. It splits the raw argument string on whitespace, shows the returned string as an
  `info` notification, and turns a thrown error into an `error` notification. Commands don't need their own try/catch.

To add a command, create `src/command/<name>.ts` exporting a function that takes the `Session` and returns a `Command`,
then add it to the list in `createCommand`. `/myPi` is a placeholder showing the shape. `/modules` lists the modules;
see [Module loading](#module-loading) for the modal it is becoming.

## Modules

Feature modules live in `src/module/<name>/`, each with a design doc in `docs/modules/<name>.md`. A module's `index.ts`
is its public surface: a class implementing `Module` (`src/module/module.ts`).

```ts
export type ModuleBase = new (session: Session) => Module;

export interface Module {
  readonly session: Session;
  get info(): ModuleInfo;  // name, description, command infos, loadType
  init(): void;            // register event handlers and tools, restore state
  commands(): Command[];   // registered through registerCommand, wrapped by runCommand
}
```

- `ModuleBase` is the constructor type, so every module is built the same way: `new Module(session)`.
- `ModuleInfo` and `ModuleLoadMode` live in `src/core/types.ts`. `loadType` is `ON_LOAD` (loaded by default) or
  `ON_DEMAND` (loaded only when chosen in `/modules`).
- `src/module/index.ts` lists the module classes. `loadModules(session)` builds each one, calls `init()` on the
  `ON_LOAD` ones, stores their `info` in `session.modules`, and returns them. `MyPi` passes them to `registerCommand`,
  which registers `commands()` from every module.
- A module reaches pi through `session.pi` and `session.ctx`, and keeps its own state as fields. Modules don't reach for
  globals or import each other's internals.

To add a module, create `src/module/<name>/index.ts` with a class implementing `Module`, then add the class to the list
in `src/module/index.ts`.

## Module loading

**Status:** planned

Which modules are loaded is decided once, on `session_start`. Loading and unloading go through `/reload`: `/modules`
saves the set you want, and the next `/reload` builds MyPi again with that set.

### Behavior

- On `session_start`, the event's `reason` picks the set:

  | `reason`                               | Loaded modules                                                       |
  |----------------------------------------|----------------------------------------------------------------------|
  | `reload`                               | The last saved set, or the defaults if the session has none          |
  | `startup`, `new`, `resume`, `fork`     | The defaults: every `ON_LOAD` module. `ON_DEMAND` modules stay off. |

  `startup` covers every session pi opens at launch, including `pi --continue`, so a reopened session starts from the
  defaults even though its saved set is still in the file.
- Only loaded modules run `init()` and get their commands registered. An unloaded module's commands don't exist.
- `/modules` opens a modal listing every module: a green `●` when loaded, a grey `○` when not. Up and down move through
  the list, Enter toggles the selected module, and Escape closes the modal.
- Toggling changes nothing yet. When the modal closes with changes, it saves the new set and notifies "Module changes
  saved. Run /reload to apply."
- The saved set belongs to the session. Running `/new` instead of `/reload` drops the change, because the new session
  starts from the defaults.

### Design in pi

| Piece          | pi hook                                                                     | Notes                                                                                                                                                                  |
|----------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Saved set      | `pi.appendEntry("mypi-modules", { loaded: string[] })` when the modal closes | Read on `reload`: the last `mypi-modules` custom entry in `ctx.sessionManager.getBranch()`. Drop names that no longer match a module. Pi's `examples/extensions/tools.ts` restores its state the same way. |
| Picking a set  | `session_start` `event.reason`                                              | `MyPi.onSessionStart` passes the reason and the saved set to `loadModules`. Keep the choice a pure function so it can be tested.                                        |
| Unregistering  | `/reload`                                                                   | Pi has no way to remove a command or tool. `registerCommand` writes to a private map. Reload throws the extension away, so commands not registered again are gone.     |
| Applying       | The user runs `/reload`                                                     | `AgentSession.reload` keeps the session and its history, rebuilds the extension, and sends `session_start` with `reason: "reload"`. It refuses while the agent is responding or compacting. |
| Modal          | `ctx.ui.custom(...)` with `SettingsList` from `@earendil-works/pi-tui`        | Same as `examples/extensions/tools.ts`. `getSettingsListTheme()` styles it, `onCancel` (Escape) calls `done()`. Only in `ctx.mode === "tui"`; other modes get an error notification. |
| Circles        | `theme.fg("success", "●")` and `theme.fg("dim", "○")`                       | Both are `ThemeColor` names in pi 1.1.0.                                                                                                                                |

### What the code needs

- **One place that knows what's loaded.** Today `PlanBuildModule.info` builds a new object on each call, so
  `isLoaded` set in `loadModules` is lost. The loaded flag has to live on something that persists: the module or a
  list that holds the modules.
- **`/modules` needs the module list,** not only `ModuleInfo` copies, so it can read each module's state and save the
  new set.
- **`registerCommand` registers commands from loaded modules only.**
- Calling `ctx.reload()` from the modal could replace the manual step later. That needs `ExtensionCommandContext` in
  `Command.execute`, and the saved-set format stays the same.

### Slices

The UI comes first, then the wiring.

1. The modal: list, circles, Enter toggles, Escape closes. It reads the current module list and changes nothing
   outside itself yet.
2. The loaded flag stored where it persists, readable by `/modules`.
3. The pure function: `reason` + saved set + module list → names to load. With tests.
4. `onSessionStart` reads the saved set and passes it in. `loadModules` and `registerCommand` skip unloaded modules.
5. Saving on close and the reload notification.

### Open questions

- Should the modal mark a toggled module whose change waits on `/reload`? The list can show the saved set, or what is
  running now with a "Reload to apply" line under it.

## Import aliases

Imports use Node subpath imports, declared under `imports` in `package.json`:

| Alias             | Resolves to             | Example                                          |
|-------------------|-------------------------|--------------------------------------------------|
| `#core/<file>`    | `src/core/<file>.ts`    | `import { Session } from "#core/session";`       |
| `#command/<file>` | `src/command/<file>.ts` | `import { modulesCmd } from "#command/modules";` |
| `#module/<file>`  | `src/module/<file>.ts`  | `import { loadModules } from "#module/index";`   |

Each alias maps to a file, not a folder. Nested paths work too: `#core/util/errors` resolves to
`src/core/util/errors.ts`, and a module folder is `#module/<name>/index`. Inside a folder, use relative imports.

Use subpath imports rather than tsconfig `paths`. Pi loads extensions through jiti, and the Homebrew and npm builds
don't apply tsconfig `paths` (only pi's TypeScript-source runtime does). Subpath imports resolve the same way in pi,
`tsc`, and vitest. All of this was checked against pi 1.1.0. Biome sorts package imports before `#` aliases.

## Runtime lifecycle

- The extension factory only registers things: commands, tools, and event handlers. It doesn't start processes, timers,
  or watchers, because pi sometimes loads extensions without starting a session.
- Long-lived resources start in `session_start` and are released in an idempotent `session_shutdown` handler.
- `/reload` replaces the extension runtime. State in memory doesn't survive it; anything that must, such as the saved
  module set, goes in the session with `pi.appendEntry`.

See the pi extension docs (`docs/extensions.md` in the installed package) for the event list and API.
