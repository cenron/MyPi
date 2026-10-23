# Project structure

```
MyPi/
├── AGENTS.md              # Agent guide: map, how we work, rules
├── CLAUDE.md              # Imports AGENTS.md for Claude Code
├── README.md
├── index.ts               # Extension entry point; creates MyPi, wires pi events
├── package.json           # pi manifest, import aliases, scripts, dependencies
├── tsconfig.json          # TypeScript 7, noEmit, bundler resolution
├── biome.json             # Formatter and linter
├── vitest.config.ts       # Tests and coverage thresholds
├── .github/workflows/     # CI: the `check` job runs `npm run check`
├── docs/
│   ├── architecture.md
│   ├── principles.md
│   ├── project-structure.md
│   ├── mcp/               # README.md: the MCP servers MyPi registers, with a status each
│   ├── modules/           # One doc per module, built or planned
│   └── tools/             # One doc per built-in tool (tools that belong to no module)
├── src/
│   ├── mypi.ts            # MyPi class: pi event handlers
│   ├── core/              # Session, ModuleManager, Notifier, PromptManager, ToolGuard, JobManager, shared types (incl. Module), util/   (#core/<file>)
│   ├── command/           # Slash commands: registry, one file or folder per command          (#command/<file>)
│   ├── tool/              # Built-in tools: registerTools, one file or folder per tool, utils.ts for helpers they share   (#tool/<file>)
│   ├── mcp/               # MCP servers MyPi registers with pi: registerMcpServers, one file per server   (#mcp/<file>)
│   ├── module/            # BaseModule (the module SDK), module list, loadModules, one folder per module   (#module/<file>)
│   └── ui/                # Feature UI (modules-modal.ts), shared footer.ts and editor.ts; components/: Dialog, ToggleList   (#ui/<file>)
├── test/                  # vitest tests, mirroring src/ (index.test.ts covers the wiring; fakes.ts: shared fakes)
└── resources/
    ├── skills/            # <name>/SKILL.md
    ├── prompts/           # <name>.md prompt templates
    └── themes/            # <name>.json themes
```

## Where new things go

| Adding | Put it in | Also |
|---|---|---|
| A module idea | `docs/modules/<name>.md` with status `idea` | Add a row to `docs/modules/README.md` |
| A built-in tool idea | `docs/tools/<name>.md` with status `idea` | Add a row to `docs/tools/README.md`. A tool a module owns goes in that module's doc instead. |
| A built-in tool | `src/tool/<name>.ts`, returning a `Tool`: `{ definition: defineTool({ … }), init?, shutdown? }`; `src/tool/<name>/index.ts` when it needs more files | Add it to `createTools` in `src/tool/index.ts`; tests in `test/tool/`; a doc in `docs/tools/` |
| An MCP server | `src/mcp/<name>.ts`, exporting a function that returns a `McpServer` (`{ name, config }`) | Add it to `createMcpServers` in `src/mcp/index.ts`; a row in `docs/mcp/README.md` |
| A slash command | `src/command/<name>.ts`, returning a `Command`; `src/command/<name>/index.ts` when it needs more files | Add it to `createCommands` in `src/command/index.ts`; tests in `test/command/` |
| A reusable TUI component | `src/ui/components/<name>.ts`, implementing pi-tui's `Component` | No feature logic; tests in `test/ui/components/` |
| A feature's UI | `src/ui/<name>.ts`, opening it through `ctx.ui.custom` | Built from `src/ui/components/`; tests in `test/ui/` |
| Module code | `src/module/<name>/index.ts`, a class extending `BaseModule` (its state type is its own) | Add it to the list in `src/module/index.ts`; tests in `test/module/<name>/` |
| A module's tool | `src/module/<name>/tools/<tool>.ts`, returning a `ToolDefinition` | Return it from the module's `tools()`, wrapped in `defineTool`; tests in `test/module/<name>/tools/` |
| A module's command | `src/module/<name>/commands/<command>/index.ts`, returning a `Command`, with files only it uses beside it | Return it from the module's `commands()`; tests in `test/module/<name>/commands/<command>/` |
| A shared service or helper | `src/core/` (helpers in `src/core/util/`) | Only once more than one place needs it; tests in `test/core/` |
| A skill | `resources/skills/<name>/SKILL.md` | |
| A prompt template | `resources/prompts/<name>.md` | |
| A theme | `resources/themes/<name>.json` | |
