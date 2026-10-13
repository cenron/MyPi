# Project structure

```
MyPi/
├── AGENTS.md              # Agent guide: map, how we work, rules
├── CLAUDE.md              # Imports AGENTS.md for Claude Code
├── README.md
├── package.json           # pi manifest, scripts, dependencies
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
│   ├── index.ts           # Extension entry point; wires modules
│   └── modules/           # One folder per module
├── test/                  # vitest tests, mirroring src/
└── resources/
    ├── skills/            # <name>/SKILL.md
    ├── prompts/           # <name>.md prompt templates
    └── themes/            # <name>.json themes
```

## Where new things go

| Adding | Put it in | Also |
|---|---|---|
| A module idea | `docs/modules/<name>.md` with status `idea` | Add a row to `docs/modules/README.md` |
| Module code | `src/modules/<name>/index.ts` | Wire it in `src/index.ts`; tests in `test/modules/<name>/` |
| Code shared by two or more modules | `src/shared/` | Only once the reuse is real |
| A skill | `resources/skills/<name>/SKILL.md` | |
| A prompt template | `resources/prompts/<name>.md` | |
| A theme | `resources/themes/<name>.json` | |
