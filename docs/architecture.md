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
  commands and modules. It logs through `log`, `logWarning`, and `logError`, and holds the `ModuleInfo` list in
  `modules`.
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

- A command is a `Command` (`src/core/types.ts`): `{ info: { name, description }, execute(ctx, args: string[]) }`.
  `ctx` is pi's `ExtensionCommandContext` for this run, which has `ui.custom`, `mode`, and later `reload()`.
  `execute` returns a string (or a promise of one) to show, or `undefined` to show nothing.
- `registerCommand(pi, session, modules)` registers everything returned by `createCommand(session)`, then each
  module's `commands()`.
- `runCommand` wraps every handler. It splits the raw argument string on whitespace, shows the returned string as an
  `info` notification, and turns a thrown error into an `error` notification. Commands don't need their own try/catch.

To add a command, create `src/command/<name>.ts` exporting a function that takes the `Session` and returns a `Command`,
then add it to the list in `createCommand`. A command that needs more than one file gets a folder,
`src/command/<name>/`, with the command in `index.ts`. `/myPi` is a placeholder showing the shape. `/modules` opens
the module modal and `/modules list` prints the module names; see [Module loading](#module-loading).

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
- `ModuleInfo` and `ModuleLoadMode` live in `src/core/types.ts`. `loadType` is `ON_LOAD` (loaded by default),
  `ON_DEMAND` (loaded only when chosen in `/modules`), or `ALWAYS` (loaded on every `session_start` and can't be
  unloaded). `loadModules` already loads `ALWAYS` modules; keeping them out of the saved set and locking their row are
  still to come (see [Module loading](#module-loading)).
- `src/module/index.ts` lists the module classes. `loadModules(session)` builds each one, calls `init()` on the
  `ON_LOAD` ones, stores a copy of each `info` with `isLoaded` set in `session.modules`, and returns them. `MyPi` passes
  them to `registerCommand`, which registers `commands()` from every module.
- A module reaches pi through `session.pi` and `session.ctx`, and keeps its own state as fields. Modules don't reach for
  globals or import each other's internals.

To add a module, create `src/module/<name>/index.ts` with a class implementing `Module`, then add the class to the list
in `src/module/index.ts`.

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
  Save row, and `onCancel` runs on Escape.

Keys follow pi's own `SettingsList` screens, so MyPi feels like pi: Enter or Space changes a row, Escape cancels. When
changes have to be saved or discarded, the list gets an Apply row, like pi's theme picker (`settings-selector.js`): a
row with one value, so activating it still fires `onChange`. `SettingsList` hard-codes its hint ("Enter/Space to change
· Esc to cancel"), so don't give its keys other meanings.

Pi-tui re-renders right after every key it delivers, so a component doesn't call `tui.requestRender()` from
`handleInput`. `getSettingsListTheme()` reads pi's global theme, so tests that build a `ToggleList` call
`initTheme("dark")` first.

## Module loading

**Status:** in progress. Slices 1 (the modal) and 2 (the loaded flag) are built.

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
  the set and closes the modal. Escape closes it and discards the changes. An `ALWAYS` module shows a locked `●`
  that Space or Enter doesn't change, so the list still shows everything that's running.
- Toggling changes nothing yet. Save stores the new set and notifies "Module changes saved. Run /reload to apply."
- `/modules list` prints the module names, one per line.
- The saved set belongs to the session. Running `/new` instead of `/reload` drops the change, because the new session
  starts from the defaults.

### Design in pi

| Piece         | pi hook                                                                                           | Notes                                                                                                                                                                                                                                                                                                      |
|---------------|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Saved set     | `pi.appendEntry("mypi-modules", { loaded: string[] })` on Save                                    | Read on `reload`: the last `mypi-modules` custom entry in `ctx.sessionManager.getBranch()`. Drop names that no longer match a module. Pi's `examples/extensions/tools.ts` restores its state the same way. Leave `ALWAYS` modules out on Save and ignore them on read, so an old saved set can't drop one. |
| Picking a set | `session_start` `event.reason`                                                                    | `MyPi.onSessionStart` passes the reason and the saved set to `loadModules`. Keep the choice a pure function so it can be tested.                                                                                                                                                                           |
| Unregistering | `/reload`                                                                                         | Pi has no way to remove a command or tool. `registerCommand` writes to a private map. Reload throws the extension away, so commands not registered again are gone.                                                                                                                                         |
| Applying      | The user runs `/reload`                                                                           | `AgentSession.reload` keeps the session and its history, rebuilds the extension, and sends `session_start` with `reason: "reload"`. It refuses while the agent is responding or compacting.                                                                                                                |
| Modal         | `ctx.ui.custom<string[] \| undefined>(...)` as an overlay, with a `Dialog` holding a `ToggleList` | See [UI components](#ui-components). Save calls `done(names)` with the selected names in list order, Escape calls `done(undefined)`. Only in `ctx.mode === "tui"`; other modes get an error notification.                                                                                                  |
| Save row      | A `SettingsList` row with a single value                                                          | Pi's theme picker (`settings-selector.js`) saves the same way, so `SettingsList`'s built-in hint stays true.                                                                                                                                                                                               |
| Locked row    | A `SettingsList` row with one value (`[●]`)                                                       | For `ALWAYS` modules. The same trick as the Save row, so the hint stays true. `ToggleItem` gets `locked?: boolean`, which keeps `ToggleList` generic.                                                                                                                                                      |
| Circles       | `theme.fg("success", "●")` and `theme.fg("dim", "○")`                                             | Both are `ThemeColor` names in pi 1.2.0.                                                                                                                                                                                                                                                                   |

### What the code needs

- **One place that knows what's loaded.** Done: `loadModules` copies each module's `info` into `session.modules` and
  sets `isLoaded` on the copy, after the spread, so the loader's value wins. A module's `info` getter can build a new
  object on every call. Read the flag from `session.modules`, never from `module.info`.
- **`registerCommand` registers commands from loaded modules only.**
- Calling `ctx.reload()` from the modal could replace the manual step later. `Command.execute` already receives the
  `ExtensionCommandContext`, and the saved-set format stays the same.

### Slices

The UI comes first, then the wiring.

1. **Done.** The modal: list, circles, Space or Enter toggles, a Save row, Escape discards. It reads the current module
   list and changes nothing outside itself. For now `/modules` shows the saved names ("Selected: …").
2. **Done.** The loaded flag: `loadModules` sets `isLoaded` on its copy in `session.modules`, and `/modules` reads it.
3. The pure function: `reason` + saved set + module list → names to load. `ALWAYS` modules are always in the result.
   With tests, including an `ALWAYS` module. The function takes the module list, so a test can pass a fake one.
   (`ALWAYS` is already in `ModuleLoadMode`.)
4. `onSessionStart` reads the saved set and passes it in. `loadModules` and `registerCommand` skip unloaded modules.
5. Save writes the result with `pi.appendEntry` and notifies "Module changes saved. Run /reload to apply."
6. Locked rows: `ToggleItem.locked`, and the modal locks `ALWAYS` modules.

### Open questions

- Should the modal mark a toggled module whose change waits on `/reload`? The list can show the saved set, or what is
  running now with a "Reload to apply" line under it.

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
