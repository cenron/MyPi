# Identity

**Status:** done (slice 1 done 2026-10-25)

## Goal

MyPi knows itself. Asked "who are you?", the agent answers as MyPi: a coding agent running on pi, on the model it's
running on, that can also build features for itself and extend itself, as the user directs. Not as the bare model
("I'm GPT…") or as plain pi. Told "I want to make some improvements to you, what's on the roadmap?",
from any folder, it goes straight to MyPi's roadmap and docs: no `find`, no searching around, no guessing.

Core, not a module (decided 2026-10-25): this isn't a feature MyPi has, it's what MyPi is. A feature is something
MyPi can do or leave out; MyPi without its identity is just pi. So it sits with the other core parts, always on.

"You", "yourself", "MyPi", "your modules", and "your roadmap" all mean the MyPi package, wherever the session runs.

## What pi offers

- **pi's preamble** opens every system prompt: "You are an expert coding assistant operating inside pi, a coding
  agent harness. …" (`buildSystemPromptSections` in pi 1.2.0's `dist/core/system-prompt.js`). It says nothing about
  MyPi or the model.
- **The preamble can't be replaced by a section:** pi throws on a custom section named `preamble`. `SYSTEM.md` or a
  `before_agent_start` result with `systemPrompt` replaces the whole prompt, tools and rules included. So MyPi adds a
  section after the preamble instead.
- **`resources/prompts/` doesn't fit:** those are prompt templates, slash commands whose text is sent only when typed
  (pi's `docs/prompt-templates.md`). The model never sees them unasked.
- **`~/.pi/agent/APPEND_SYSTEM.md`** adds static text to the prompt, but lives outside this repo, so it doesn't travel
  with MyPi and can't know which modules are running.
- **`ctx.model`** is the current model, read fresh in every `before_agent_start`, so `/model` needs no listener.

## Behavior

- A `mypi-identity` section in every run, short (it's paid for on every request):
  - It is MyPi, a coding agent running on the pi agent harness. Besides coding in the user's projects, it can build
    features and functionality for itself and extend itself, directed by the user. "You", "yourself", and "MyPi" in
    the user's words mean MyPi, its code, and its docs.
  - The model it's running on, as `<provider>/<id>`, from that run's `ctx.model`.
  - The modules running this session, by name (`moduleManager.moduleInfos`, `isLoaded`).
  - **Where to look, as absolute paths found at runtime** (never written into a tracked file; the repo is public):
    - `AGENTS.md`: the map of the repo and how the user works with agents on it. Read first for any work on MyPi.
    - `docs/roadmap.md`: what's next, in order, and what's done or deferred. "What's on the roadmap" or "what should
      we build next" means this file.
    - `docs/modules/<name>.md`, `docs/tools/<name>.md`, `docs/rules/<name>.md`: each part's design and status; code
      in `src/module/<name>/`, `src/tool/`, `src/rule/`.
    - `docs/principles.md`: read before proposing a change.
  - Read those paths directly; don't search for them.
  - Asked who it is: MyPi, running on pi, naming the model; not the bare model or another harness.
- Mode isn't repeated: plan-build's own section already says when Plan is on.

### Working on MyPi from another folder

- **Reading** MyPi's docs from another session folder goes through the [folder guard](../rules/folder-guard.md): the
  first read asks, and with slice 4 one "Allow for this session" on the MyPi folder covers the rest. So no new seam:
  one question per session, which is the guard doing its job. Not taking: allowing the MyPi folder outright; it would
  allow edits and `bash` there too, from any project, unasked.
- **Changing** MyPi belongs in a session started in the MyPi folder. From anywhere else the done check scans the wrong
  folder (`fileTimes(ctx.cwd)`), its commands run there, LSP roots and git are the other project's, and MyPi's
  `AGENTS.md` isn't in the prompt. So the section says: for questions about MyPi, read the docs; to change it, tell
  the user to start pi in the MyPi folder (path given), unless they say to go ahead here. The
  [worktree](../tools/worktree.md) tool may change this later.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Section text | `identityPrompt(model, modules, root)` in `src/core/identity.ts` | Pure, so the test needs no session. |
| Section | `MyPi.onBeforeAgentStart`: `session.promptManager.set("identity", …)` just before `apply` | Rebuilt every run, so the model is always current; no `model_select` listener, no state. `PromptManager` keys sections by name, so a module named `identity` would clash; none is. |
| Model | `ctx.model` from `before_agent_start` | Can be undefined before a model is picked; say so plainly then. |
| Modules | `session.moduleManager.moduleInfos`, `isLoaded` | Fixed until `/reload`, cheap to read each run. |
| Paths | The MyPi root from `src/core/identity.ts` itself: `fileURLToPath(new URL("../../", import.meta.url))` | Checked 2026-10-25: jiti gives `import.meta.url` (and `__dirname`). |

## Slices

1. The section with identity, model (kept current), running modules, and the paths to look at. Tests: the section
   names the model, the loaded modules, and the roadmap and `AGENTS.md` paths under the root it's given, and handles no
   model; `onBeforeAgentStart` writes it as `mypi-identity`. Live tests, from a folder other than MyPi's:
   - "who are you?" in Build and Plan, before and after `/model`, and with a module turned off in `/modules`;
   - "I want to make some improvements to you, what's on the roadmap?": its first tool call reads
     `docs/roadmap.md` by its full path (one folder-guard question, no `find` or `ls` first), and it answers from
     **Next up**;
   - "change X in yourself": it suggests starting pi in the MyPi folder.

   **Done 2026-10-25.** `src/core/identity.ts`, set in `MyPi.onBeforeAgentStart`; tests in
   `test/core/identity.test.ts` and `test/index.test.ts`. Tried live:
   - In the MyPi folder, Plan: "who are you" answered "I'm MyPi, your coding agent running on the pi harness, powered
     by openai/gpt-6.1-sol"; the roadmap question read `AGENTS.md`, then `docs/roadmap.md`, with no search.
   - From `pi-workspace`, Plan: the same answer; "I want to make some improvements to you. What's next on your
     roadmap?" read `~/.pi/MyPi/AGENTS.md` first, then `docs/roadmap.md`, by their full paths, with no `find` or
     `ls`; answered from **Next up**, and added that work on MyPi should start pi in `~/.pi/MyPi/`. The folder guard
     asked once per file (six times), which [folder-guard slice 4](../rules/folder-guard.md#slices) fixes.
   - Build, same folder: it named Build mode; "change yourself so the jobs footer item uses the warning color" made
     no edit and asked to start pi in `~/.pi/MyPi/`, or to be told to go ahead here.
   - After `/model` to `openai/gpt-5.6-sol`: it named the new model.
   - With lsp turned off in `/modules` and `/reload`: "plan-build, memory, and done-check".

## References

- pi: `buildSystemPromptSections` in `dist/core/system-prompt.js`, `docs/configuration.md` (`SYSTEM.md`,
  `APPEND_SYSTEM.md`), `docs/prompt-templates.md`

## Decided 2026-10-25

- Core, not a module: always on.
- It speaks as MyPi, a coding agent running on pi that can extend itself as the user directs; not as "the user's
  package" or as plain pi.
