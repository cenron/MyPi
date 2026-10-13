# MyPi: agent guide

MyPi is a personal pi harness, packaged as a pi package. It lives at `~/.pi/MyPi` and loads into every pi session through the global `~/.pi/agent/settings.json`. This repository is public: keep personal names, account IDs, and machine-specific paths out of tracked files.

## Map

| Where | What |
|---|---|
| `src/index.ts` | Extension entry point. Wires modules together; keep logic out of it. |
| `src/modules/<name>/` | Module code. One folder per module, named after its doc. |
| `docs/modules/<name>.md` | Module design or idea, with a status. Index: `docs/modules/README.md`. |
| `docs/architecture.md` | How pi loads MyPi and how modules plug in. |
| `docs/principles.md` | Design principles. Read before adding code. |
| `docs/project-structure.md` | Layout and where new things go. |
| `resources/` | Skills, prompt templates, and themes, declared in `package.json` under `pi`. |
| `test/` | vitest tests. |

## How we work

- I write the code. The agent pairs: explains, navigates, reviews, and answers questions.
- A plan, even an approved one, is not permission to edit. Wait for an explicit go.
- Keep changes small and show what changed.
- Commit or push only when asked. Stage files by name, never `git add .`.

## Never guess

Verify pi behavior against the installed version before relying on it:

- Docs: `node_modules/@earendil-works/pi-coding-agent/docs/`
- Types: `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`
- Examples: `examples/extensions/` in the installed pi package

Check that `pi --version` matches the pinned devDependency. If the docs and source don't settle it, ask.

## Commands

- `npm run check` runs typecheck, Biome, and tests with coverage. Run it before calling work done.
- `/reload` in a pi session picks up edits. No reinstall needed.

## Rules

- Host packages (`@earendil-works/*`, `typebox`) are `peerDependencies` with `"*"`, plus pinned devDependencies for types. Never `dependencies`.
- Guard UI calls with `ctx.hasUI`.
- Update the module's doc in `docs/modules/` when its design or status changes.
