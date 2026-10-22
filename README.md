# MyPi

A personal [pi](https://pi.dev) harness: extensions, skills, prompt templates, and themes for my workflow, packaged as one pi package and loaded into every pi session.

## Install

### Use it

```bash
pi install git:git@github.com:cenron/MyPi
```

Pi clones the repository into its package directory and installs runtime dependencies only. Pin a version with `@<tag>`. `pi update` reconciles this checkout, so don't edit code there.

### Develop it

```bash
git clone git@github.com:cenron/MyPi.git ~/.pi/MyPi
cd ~/.pi/MyPi
npm install
pi install ~/.pi/MyPi
```

Pi loads the checkout in place. Run `/reload` in a session to pick up edits.

### New machine

Either path above works on a fresh machine. Credentials (`~/.pi/agent/auth.json`), personal settings, and sessions are not part of this repository, so log in again after installing. Check that `pi --version` matches the pinned `@earendil-works/pi-coding-agent` devDependency, and bump it if not.

## Configure

web_search works without keys. A key only raises a search service's limits: set either variable before starting pi.

| Variable | Sent as |
|---|---|
| `PARALLEL_API_KEY` | `Authorization: Bearer …` to Parallel |
| `EXA_API_KEY` | `x-api-key` to Exa |

MyPi never stores the key: pi reads the variable when it connects. To change anything else about these servers (a key
from a password manager with `!command`, another exposure), add a full `parallel` or `exa` entry to
`~/.pi/agent/mcp.json`; it replaces MyPi's. See [MCP servers](docs/mcp/README.md#keys).

## Develop

| Script | What it does |
|---|---|
| `npm run check` | Typecheck, lint, and test with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `lint:fix` | Biome check, optionally writing fixes |
| `npm test` / `test:cov` | vitest, optionally with v8 coverage |

Docs live in [`docs/`](docs/): [architecture](docs/architecture.md), [principles](docs/principles.md), [project structure](docs/project-structure.md), and [modules](docs/modules/README.md).

## License

MIT
