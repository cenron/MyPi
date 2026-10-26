# pi-vs-claude-code

A playground of pi extensions by disler, built to show how far pi can be customized compared with Claude Code: agent
orchestration, agent-to-agent messaging, safety rules, loading other harnesses' files, and UI tweaks. Each extension
is one file, run with `pi -e extensions/<name>.ts` and stackable.

- **Repository:** [disler/pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code), commit `0ed11f4`
  (2026-07-10), read 2026-10-26. 1.7k stars.
- **License:** MIT.
- **Post-MVP:** none of these fold cleanly into the current roadmap, so they wait under the roadmap's
  [Future discussions](../roadmap.md#future-discussions); the right column says where each would fit.
- **Feeds:** [subagents](../modules/subagents.md) (chains, teams, agent files from other harnesses, peer messaging),
  the [folder guard](../rules/folder-guard.md) and `ToolGuard` (rule files), [analytics](../modules/analytics.md)
  (a live tool tally). Its theme and footer extensions feed the themes nice-to-have, with
  [pi-cc-tools](pi-cc-tools.md).

## Features worth knowing, apart from the UI

| Extension | What it does | For MyPi |
|---|---|---|
| `agent-chain` | A pipeline: steps in `.pi/agents/agent-chain.yaml`, each an agent and a prompt, where `$INPUT` is the last step's output and `$ORIGINAL` the user's prompt (`plan-build-review`: planner → builder → reviewer). `/chain` picks one. | A later [subagents](../modules/subagents.md) slice: workflows over named agents. pi-subagents has the same idea; one design for both. |
| `agent-team` | A dispatcher-only main agent that hands everything to specialists through `dispatch_agent`; teams in `.pi/agents/teams.yaml` (`frontend: [planner, builder, bowser]`), with a grid dashboard. | MyPi's main agent orchestrates *and* works (decision 7 in subagents). A team as a named group of agents could come with milestone 3 (creating agents), if a need shows up. |
| `pi-pi` | A meta-agent that builds pi extensions, with one expert agent per pi area (extensions, themes, TUI, keybindings, skills, config, CLI, prompts) researching the docs in parallel. | A pattern for MyPi's own agents: per-area experts whose prompts name the right pi docs. Fits "improve yourself" ([identity](../core/identity.md)) once creating agents exists. |
| `cross-agent` | Scans `.claude/`, `.gemini/`, `.codex/` for commands, skills, and agents, and registers them in pi. | The subagents loader could also read Claude Code's agent files (`.claude/agents/*.md`, similar frontmatter), so agents written for Claude Code work in MyPi. Skills are already shared through `~/.agents/skills`. |
| `coms`, `coms-net` | Peer-to-peer messaging between pi agents, same machine (Unix sockets) or networked (an HTTP/SSE hub): four tools (`list`, `send`, `get`, `await`), a hop limit against A→B→A loops, an audit log without prompt bodies, heartbeats, localhost by default. | A different primitive from subagents (flat, not a parent and children). Worth remembering for [external agents](../modules/subagents.md#external-agents-later) in herdr panes: the four-tool surface and the hop limit carry over. |
| `damage-control` | Safety rules from `.pi/damage-control-rules.yaml` on `tool_call`: dangerous `bash` patterns blocked or asked (`rm -rf`, `git reset --hard`, `DROP DATABASE`), zero-access paths (`.env`, `~/.ssh/`, `*.pem`), read-only paths (lockfiles, `/etc/`), no-delete paths (`.git/`, `Dockerfile`). A `-continue` variant returns feedback instead of aborting. | MyPi's folder guard asks before any call outside the folder and Plan blocks writes, and a refusal already lets the run continue. New here: **zero-access paths inside the project** (`.env`, keys) and **no-delete paths**; candidates for folder-guard slices if wanted. A YAML rule file would be MyPi's first config of that kind. |
| `purpose-gate` | Asks for the session's purpose at start, shows it in a widget, and blocks prompts until it's given. | Close to [pair-programmer](../modules/pair-programmer.md)'s "what are we doing"; not wanted as a gate. |
| `tilldone` | Tasks defined before work starts, tracked across steps, shown in the footer. | Covered by [todo](../modules/todo.md). |
| `tool-counter` | A footer with the model, a context meter, token and cost stats, and a per-tool call tally. | A live view of [analytics](../modules/analytics.md)'s counts, such as the code-navigation mix. |
| `session-replay` | A scrollable timeline overlay of the session. | A later idea; pi's `/tree` covers navigation. |
| `system-select` | `/system` switches the agent's persona (system prompt) from agent files in `.pi/agents/`, `.claude/agents/`, and others. | Not planned: MyPi's agents run as subagents, not as the main session's persona. |

## UI parts (for the themes nice-to-have)

- Themes as JSON in `.pi/themes/`, a `/theme` command and keys to cycle them, and a colour swatch shown briefly after
  each switch (`theme-cycler`); a default theme per extension (`themeMap`).
- Footers replaced whole with `setFooter`: a model name and a 10-block context meter (`minimal`), or nothing at all
  (`pure-focus`).
- A colour language for extension authors (`THEME.md`): `success` for live values, `accent` for names and percentages,
  `warning` for punctuation and frames, `dim` for labels, `muted` for subdued text.
