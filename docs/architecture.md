# Architecture

## How pi loads MyPi

MyPi is a pi package. The global settings file, `~/.pi/agent/settings.json`, lists it under `packages`, so every pi session loads it regardless of the working directory. The repository sits beside the agent directory, not inside it, so credentials and sessions stay out of git.

Pi reads the `pi` manifest in `package.json` to find resources:

| Manifest key | Path | Loaded as |
|---|---|---|
| `extensions` | `./src/index.ts` | One extension, loaded through jiti. No build step. |
| `skills` | `./resources/skills` | Skill directories, available as `/skill:<name>` |
| `prompts` | `./resources/prompts/*.md` | Prompt templates, available as slash commands |
| `themes` | `./resources/themes/*.json` | Themes |

Pi supplies the host packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, `typebox`) at runtime. MyPi declares them as peers so it never ships a second copy.

## Entry point and modules

`src/index.ts` is the single extension entry point. It receives `ExtensionAPI` and wires the modules together. It holds no feature logic.

Each module lives in `src/modules/<name>/` and exports a function that takes what it needs (the `ExtensionAPI`, config, other dependencies) as arguments. The entry point calls each one. Modules don't reach for globals or import each other directly. Shared code moves to `src/shared/` only once two modules actually need it.

## Runtime lifecycle

- The extension factory only registers things: commands, tools, and event handlers. It doesn't start processes, timers, or watchers, because pi sometimes loads extensions without starting a session.
- Long-lived resources start in `session_start` and are released in an idempotent `session_shutdown` handler.
- `/reload` replaces the extension runtime. Don't carry state across it.

See the pi extension docs (`docs/extensions.md` in the installed package) for the event list and API.
