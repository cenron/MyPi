# MyPi: agent guide

MyPi is a personal pi harness, packaged as a pi package. It lives at `~/.pi/MyPi` and loads into every pi session
through the global `~/.pi/agent/settings.json`. This repository is public: keep personal names, account IDs, and
machine-specific paths out of tracked files.

## Map

| Where                       | What                                                                                                                                                                                                   |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `index.ts`                  | Extension entry point at the repo root, so pi labels it `MyPi`. Creates `MyPi` and wires pi events to it; no logic.                                                                                    |
| `src/mypi.ts`               | `MyPi` class. Handles pi events; on `session_start` it builds a `Session`, picks the modules, registers tools, runs the modules' `init()`, registers commands, then MCP servers.                                                                    |
| `src/core/`                 | Per-session services (`Session`, `ModuleManager`, `Notifier`, `PromptManager`, `ToolGuard`, `JobManager`), the event bus between parts (`events.ts`, over `pi.events`), shared types (`types.ts`: `Command`, `Module`, `ModuleInfo`, `ModuleLoadMode`), and `util/`. Imported as `#core/<file>`.                |
| `src/command/`              | Slash commands: one file (or folder) per command, listed in `createCommand` in `index.ts`. Imported as `#command/<file>`.                                                                              |
| `src/tool/`                 | Built-in tools: one file (or folder) per tool, listed in `createTools` in `index.ts`; `registerTools` adds the running modules' `tools()`; `utils.ts` holds helpers the tools share. Imported as `#tool/<file>`. |
| `src/rule/`                 | MyPi's own tool rules, always on: one class per rule extending `BaseRule` (`base.ts`), listed in `createRules` in `index.ts`; `registerRules` sets them on the session's `ToolGuard`. Imported as `#rule/<file>`. |
| `src/mcp/`                  | MCP servers MyPi registers with pi: one function per server, listed in `createMcpServers` in `index.ts`. Imported as `#mcp/<file>`.                                                                    |
| `src/ui/`                   | Feature UI (`modules-modal.ts`), the shared `footer.ts` and `editor.ts`, and `components/`: reusable TUI components (`Dialog`, `ToggleList`). Imported as `#ui/<file>`.                                                                         |
| `src/module/`               | Feature modules: `BaseModule`, the SDK every module extends (`base.ts`), the module list and `loadModules` (`index.ts`), and one folder per module, named after its doc. Imported as `#module/<file>`. |
| `docs/modules/<name>.md`    | Module design or idea, with a status. Index: `docs/modules/README.md`.                                                                                                                                 |
| `docs/rules/<name>.md`      | Built-in tool rule design (rules in `src/rule/`, always on), with a status. Index: `docs/rules/README.md`.                                                                                     |
| `docs/tools/<name>.md`      | Built-in tool design or idea (tools that belong to no module), with a status. Index: `docs/tools/README.md`.                                                                                           |
| `docs/mcp/README.md`        | MCP servers MyPi registers with pi out of the box, with a status per server.                                                                                                                           |
| `docs/roadmap.md`            | What to build next, in order, and what's deferred or done. Start here when asked what's next.                                                                                                          |
| `docs/inspiration/<name>.md` | Outside projects worth learning from, and which of their ideas fit MyPi. Index: `docs/inspiration/README.md`.                                                                                          |
| `docs/architecture.md`      | How pi loads MyPi and how modules plug in.                                                                                                                                                             |
| `docs/principles.md`        | Design and coding principles: stay lean, clean code, idiomatic TypeScript, and the checklist before a slice is done. Read before adding code.                                                          |
| `docs/project-structure.md` | Layout and where new things go.                                                                                                                                                                        |
| `resources/`                | Skills, prompt templates, and themes, declared in `package.json` under `pi`.                                                                                                                           |
| `test/`                     | vitest tests, mirroring `src/`.                                                                                                                                                                        |

## How we work

- I write the code. The agent pairs: explains, navigates, reviews, and answers questions.
- A plan, even an approved one, is not permission to edit. Wait for an explicit go.
- Stay lean ([principles](docs/principles.md)): look for what pi, Node, or MyPi already has before writing code. A
  large slice reports the lines it added and removed.
- When code contradicts a principle, say so in the review; we decide together whether the code or the principle changes.
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
- `npx biome check --write .` fixes formatting, `index.ts` included. Biome wraps at 120 columns. The editor must
  format with Biome; its built-in formatter produces 4-space indents that fail the check.
- `/reload` in a pi session picks up edits. No reinstall needed.
- Restart pi after changing `imports` in `package.json`. `/reload` keeps the old import map.

## Rules

- Host packages (`@earendil-works/*`, `typebox`) are `peerDependencies` with `"*"`, plus pinned devDependencies for
  types. Never `dependencies`.
- Before adding code, check what pi exports and what Node has built in. A runtime dependency (`dependencies`) must be
  maintained by a company or foundation organization (Microsoft, Mozilla, Node.js, tree-sitter, …) or already be in
  pi's own dependency tree, be actively developed, and have a manageable issue log: check the last push, last
  release, and open issues first. Add one only when it removes real code or work. `turndown`,
  `turndown-plugin-gfm`, and `@mixmark-io/domino` predate this rule.
- Send notifications through `Session` (`log`, `logWarning`, `logError`), which already guards `ctx.hasUI`. Guard
  dialogs and other UI calls with `ctx.hasUI` yourself.
- Import across folders with `#core/<file>`, `#command/<file>`, `#tool/<file>`, `#module/<file>`, `#ui/<file>`,
  `#mcp/<file>`, and `#rule/<file>` (the `imports` in `package.json`), never tsconfig `paths`, because pi doesn't apply them. Use relative
  imports inside a folder. Leave `.ts` off import paths.
- Wrap every tool in pi's `defineTool` where it's built; without it `execute`'s arguments are silently `any`.
- Name module-level helpers with `function` declarations. Keep a `const` only when a library's function type types it
  (`LookupFunction`, `MessageRenderer`, `ToolRendererResolver`).
- Class members are methods. Use an arrow property only for a callback that's passed around unbound
  (`Editor.reportError`). Arrow properties aren't on the prototype, so `vi.spyOn(Class.prototype, …)` can't see them.
- Expose a class's parts as `readonly` properties, not a private field plus a getter that only returns it.
- Update the module's doc in `docs/modules/`, or the tool's doc in `docs/tools/`, when its design or status changes.

## Tests

Test each behavior once, at the lowest level that shows it:

- Pure helpers (`src/core/util/`, a tool's `address.ts`) get table tests: one row per rule, not several examples of
  the same rule. Security tables (`isReadOnlyCommand`, the address ranges) are the spec and keep one row per case.
- A tool's or module's own tests cover only the wiring: that each helper is called, with the right inputs, once per
  behavior. Don't repeat a helper's table through the tool.
- Display code (`renderCall`, `renderResult`, footers) gets a few tests, not one per line of output.
- Check exact wording in one place; elsewhere match a key phrase, so rewording a message breaks one test.
- Check a new test catches something: break the code it covers and watch it fail.
- Coverage only has to stay at 85% (`vitest.config.ts`). Don't add a test just to cover a line; leave out tests for
  plain glue and for paths a higher-level test already runs through.
