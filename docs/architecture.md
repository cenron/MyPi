# Architecture

## How pi loads MyPi

MyPi is a pi package. The global settings file, `~/.pi/agent/settings.json`, lists it under `packages`, so every pi session loads it regardless of the working directory. The repository sits beside the agent directory, not inside it, so credentials and sessions stay out of git.

Pi reads the `pi` manifest in `package.json` to find resources:

| Manifest key | Path | Loaded as |
|---|---|---|
| `extensions` | `./index.ts` | One extension, loaded through jiti. No build step. |
| `skills` | `./resources/skills` | Skill directories, available as `/skill:<name>` |
| `prompts` | `./resources/prompts/*.md` | Prompt templates, available as slash commands |
| `themes` | `./resources/themes/*.json` | Themes |

Pi supplies the host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`) at runtime. MyPi declares them as peers so it never ships a second copy.

## Startup flow

```
index.ts               default factory: new MyPi(pi), then pi.on("session_start" | "session_shutdown", …)
└─ src/mypi.ts         MyPi.onSessionStart(ev, ctx)
   ├─ new Session(ctx, pi)                       src/core/session.ts
   ├─ loadModules(session)                       src/module/index.ts: new each module, then init()
   └─ registerCommand(pi, session, modules)      src/command/index.ts
```

`index.ts` at the repo root is the single extension entry point. It creates the `MyPi` object and routes pi events to its methods. It holds no logic.

`MyPi` (`src/mypi.ts`) owns the event handlers. On `session_start` it builds a `Session` for that session's context, loads the modules, and registers the commands, its own and the modules'.

Each extension instance sees exactly one `session_start`. New, resume, fork, and `/reload` tear the extension down and load it fresh (`agent-session-runtime.js` builds new services for each session, and `AgentSession.reload` replaces the extension runner). So `MyPi`, its `Session`, and its modules all live for one session, and handlers registered during `session_start` never stack up.

## Core

`src/core/` holds the services every part of MyPi shares, imported as `#core/<file>`.

- **`Session`** wraps the `ExtensionContext` from `session_start` and the `ExtensionAPI`. It's the handle passed to commands and modules. It logs through `log`, `log_warning`, and `log_error`.
- **`Notifier`** sends those messages to `ctx.ui.notify` and skips them when `ctx.hasUI` is false (print and JSON modes).
- **`MessageType`** is a const object plus a type of the same name: the values are `"info" | "warning" | "error"`, derived from the object, and match pi's `notify` signature. It generates no runtime code beyond the object, unlike `enum`.
- **`util/errors.ts`** has `errorMessage` (any thrown value to a string) and `isNodeError` (narrows to `NodeJS.ErrnoException`).

## Commands

`src/command/` implements slash commands.

- A command is a `Command`: `{ name, description, execute(args: string[]) }`. `execute` returns a string (or a promise of one) to show, or `undefined` to show nothing.
- `registerCommand(pi, session)` registers everything returned by `createCommand(session)`.
- `runCommand` wraps every handler. It splits the raw argument string on whitespace, shows the returned string as an `info` notification, and turns a thrown error into an `error` notification. Commands don't need their own try/catch.

To add a command, create `src/command/<name>.ts` exporting a function that takes the `Session` and returns a `Command`, then add it to the list in `createCommand`. `/myPi` is a placeholder showing the shape.

## Modules

Feature modules live in `src/module/<name>/`, each with a design doc in `docs/modules/<name>.md`. A module's `index.ts` is its public surface: a class implementing `Module` (`src/module/module.ts`).

```ts
export type ModuleBase = new (session: Session) => Module;

export interface Module {
  readonly session: Session;
  init(): void;           // register event handlers and tools, restore state
  commands(): Command[];  // registered through registerCommand, wrapped by runCommand
}
```

- `ModuleBase` is the constructor type, so every module is built the same way: `new Module(session)`.
- `src/module/index.ts` lists the module classes. `loadModules(session)` builds each one, calls `init()`, and returns them. `MyPi` passes them to `registerCommand`, which registers `commands()` from every module.
- A module reaches pi through `session.pi` and `session.ctx`, and keeps its own state as fields. Modules don't reach for globals or import each other's internals.

To add a module, create `src/module/<name>/index.ts` with a class implementing `Module`, then add the class to the list in `src/module/index.ts`.

## Import aliases

Imports use Node subpath imports, declared under `imports` in `package.json`:

| Alias | Resolves to | Example |
|---|---|---|
| `#core/<file>` | `src/core/<file>.ts` | `import { Session } from "#core/session";` |
| `#command/<file>` | `src/command/<file>.ts` | `import type { Command } from "#command/types";` |
| `#module/<file>` | `src/module/<file>.ts` | `import { loadModules } from "#module/index";` |

Each alias maps to a file, not a folder. Nested paths work too: `#core/util/errors` resolves to `src/core/util/errors.ts`, and a module folder is `#module/<name>/index`. Inside a folder, use relative imports.

Use subpath imports rather than tsconfig `paths`. Pi loads extensions through jiti, and the Homebrew and npm builds don't apply tsconfig `paths` (only pi's TypeScript-source runtime does). Subpath imports resolve the same way in pi, `tsc`, and vitest. All of this was checked against pi 1.1.0. Biome sorts package imports before `#` aliases.

## Runtime lifecycle

- The extension factory only registers things: commands, tools, and event handlers. It doesn't start processes, timers, or watchers, because pi sometimes loads extensions without starting a session.
- Long-lived resources start in `session_start` and are released in an idempotent `session_shutdown` handler.
- `/reload` replaces the extension runtime. Don't carry state across it.

See the pi extension docs (`docs/extensions.md` in the installed package) for the event list and API.
