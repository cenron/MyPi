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
│   └── modules/           # One doc per module, built or planned
├── src/
│   ├── mypi.ts            # MyPi class: pi event handlers
│   ├── core/              # Session, ModuleManager, Notifier, shared types (incl. Module), util/   (#core/<file>)
│   ├── command/           # Slash commands: types, registry, one file or folder per command   (#command/<file>)
│   ├── module/            # Module list, loadModules, one folder per module   (#module/<file>)
│   └── ui/                # Feature UI (modules-modal.ts); components/: Dialog, ToggleList   (#ui/<file>)
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
| A slash command | `src/command/<name>.ts`, returning a `Command`; `src/command/<name>/index.ts` when it needs more files | Add it to `createCommand` in `src/command/index.ts`; tests in `test/command/` |
| A reusable TUI component | `src/ui/components/<name>.ts`, implementing pi-tui's `Component` | No feature logic; tests in `test/ui/components/` |
| A feature's UI | `src/ui/<name>.ts`, opening it through `ctx.ui.custom` | Built from `src/ui/components/`; tests in `test/ui/` |
| Module code | `src/module/<name>/index.ts`, a class implementing `Module` | Add it to the list in `src/module/index.ts`; tests in `test/module/<name>/` |
| A shared service or helper | `src/core/` (helpers in `src/core/util/`) | Only once more than one place needs it; tests in `test/core/` |
| A skill | `resources/skills/<name>/SKILL.md` | |
| A prompt template | `resources/prompts/<name>.md` | |
| A theme | `resources/themes/<name>.json` | |
