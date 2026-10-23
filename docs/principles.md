# Principles

How MyPi is designed and written. Read before adding code; check a slice against [Before a slice is done](#before-a-slice-is-done)
before calling it finished. The coding rules that are pure mechanics (imports, aliases, `defineTool`) are in
[AGENTS.md](../AGENTS.md#rules).

**The code as of 2026-10-23 is the baseline.** These principles were written to match it: where a draft rule
disagreed with how MyPi was already built, the rule was reworded. From here on, when new or changed code contradicts a
principle, the review points it out and we decide together: change the code, or reword the principle. Neither wins by
default.

The bar: MyPi stays small enough to read in an afternoon. On 2026-10-23 it was about 3,600 lines of source in 57 files.
pi-subagents, which does one of MyPi's future modules, is about 275,000 lines with tests. We don't write code like
that: every line has to earn its place.

## Modular

MyPi is built from parts with clear edges, and lean never means fewer edges.

- **Every feature is a module or a tool,** unless more than one part needs it; then it's core.
- **A part can be turned off or deleted** without touching the others.
- **Parts talk through the seams:** `Session`, `BaseModule`, and the core services (`ToolGuard`, `PromptManager`,
  `JobManager`, the footer, the tool and MCP lists), never into each other's files.
- **New features plug into the existing seams.** A new seam (a hook, a list, a registry) is added when a design on the
  [roadmap](roadmap.md) needs it, even if it has one user today, and its doc says who comes next. The `PlanChoice`
  list and the module system were built that way.

## Lean

Lean is about waste inside the parts: unused options, dead code, duplicated logic, files that sprawl, features nobody
asked for. It never argues against the structure above.

- **Look before you write.** In order: what pi exports, what Node has built in, a helper MyPi already has, a
  dependency (by the rule in [AGENTS.md](../AGENTS.md#rules)). New code comes last.
- **Build the slice, not the framework.** Code for the need in front of us. No option, config key, or flag without
  someone using it today. A helper waits for its third use; three similar lines beat a premature helper. (Seams are
  different; see [Modular](#modular).)
- **One way to do a thing.** A second path to the same result needs a reason the first can't meet. Convenience isn't
  one.
- **Hard cutovers.** When something changes, the old way goes: no aliases, shims, compatibility modes, or tests that
  keep removed behavior alive. Delete, don't comment out.
- **Cut features before code.** When a design grows, first ask what to leave out; the module docs keep a "not taking"
  list for exactly that.
- **Size is a signal.** A file past about 250 lines, or a function that doesn't fit on one screen (about 40 lines), is a
  prompt to ask whether it's two things, not a hard limit. `src/core/util/shell.ts` is long on purpose: it's a
  security check, and its rules read best together.
- **Watch growth.** A slice that adds more than a few hundred lines reports its lines added and removed, with the
  reason it needs them. A slice that only removes code is a good slice.

## Design

- **Small files with clear boundaries.** One concept per file, one folder per module or tool.
- **Composition at the entry point.** `index.ts` creates `MyPi` and routes pi events to it. Dependencies such as the
  `Session` come in as arguments, never as globals.
- **Modules own their stuff.** A module's state, commands, tools, prompt section, and rules live with the module and go
  through `BaseModule`. Core holds only what more than one module needs.
- **Pure rules, effects at the edges.** Decisions are pure functions (`planRule`, `tokenize`, `isPublicAddress`) that
  take what they need and return a value; tools, modules, and core services do the I/O around them. That's also what
  makes them cheap to test.
- **Validate at boundaries only.** Check tool parameters, saved data, config, and replies from other systems; trust
  internal code.
- **No silent fallback.** When something can't be done, say so with what to do next. Never switch to another model,
  runner, path, or behavior on your own.
- **Idempotent operations.** Running a command or registering something twice must not duplicate or clobber anything.
- **Consistency.** Once a pattern exists, use it everywhere.
- **Verify, don't guess.** Check pi behavior against the installed docs, types, and examples before relying on it.

## Clean code

Loosely after *Clean Code*: the parts that make code easier to read, not ceremony.

- **Names say what, not how.** A reader shouldn't need the body to know what a function returns or a variable holds.
  No abbreviations beyond the common ones (`ctx`, `id`, `args`).
- **A function does one thing.** If its name needs "and", it's two functions. Prefer two functions to a boolean
  parameter that switches behavior.
- **Narrative code.** Guard clauses at the top, then orchestrators that read like an outline, with helpers doing the
  work.
- **Errors say what to do.** A message names what failed and the next step ("not a public address; for a local
  server, use curl in bash"). Throw at the boundary that can explain it; don't swallow errors to look tidy.
- **Comments explain why.** Shared helpers, types, and interfaces get a one-line JSDoc that says why they exist or what
  to watch for. No comments that restate the code, and no commented-out code.
- **Named constants.** A number or string that means something gets a `CONSTANT_CASE` name (`MAX_BRACE_WORDS`).

## TypeScript

Idiomatic TypeScript, following the [Google TypeScript style guide](https://google.github.io/styleguide/tsguide.html)
where these rules don't say otherwise:

- **Strict, and no `any`.** Values from outside start as `unknown` and are narrowed with guards
  (`src/core/util/guards.ts`) or TypeBox schemas.
- **Casts only at boundaries**, where a library or saved data can't be typed better, with the reason clear from the
  code around it. No non-null assertions (`!`).
- **`type` for shapes and unions; `interface` only for a contract classes implement** (`Module`).
- **Const objects, not `enum`:** `as const`, with `satisfies` when the values must fit a type (`FooterColor`). A
  discriminated union (`Verdict`) for results that can go several ways.
- **Named exports only.** The one default export is `index.ts`, because pi requires it.
- **`readonly` by default** for properties and parameters that don't change. Expose a class's parts as `readonly`
  properties, not private fields with getters.
- **`function` declarations for module-level helpers; methods for class members.** Arrow functions for callbacks and
  for values a library's function type types.
- **`Map` and `Set` for lookups keyed by outside strings.** An object literal finds `toString` on its prototype.
- **Promises are awaited or returned.** A promise left on purpose is marked with `void` and a reason.
- **Small dependency surface:** import only what's used, and keep host packages as peers.

## Tests

The rules are in [AGENTS.md](../AGENTS.md#tests): each behavior once, at the lowest level that shows it; table tests
for pure rules; a few tests for display code; break the code to see a new test fail; coverage only has to stay at 85%.
Tests count toward "lean" too. **Tests are sacred:** never change a test just to make it pass; when one fails, assume
the code is wrong until the real behavior is confirmed.

## What we refuse

From reading other harnesses (see [inspiration](inspiration/README.md)):

- Config keys, modes, or flags that nobody asked for.
- A second path to something one ordinary action already does.
- Plug points nobody on the roadmap will use.
- Defensive code and tests for situations that can't happen, or for behavior that was removed.
- Files that only grow: when one passes its size signal, split it or cut it.
- Silent fallbacks, and success reported without evidence.

## Before a slice is done

1. `npm run check` passes.
2. The size matches what the slice does; a large slice reports its lines added and removed.
3. Nothing in the diff is unused, commented out, or kept for compatibility.
4. Could anything be deleted? Look once more, in the new code and the code it touched.
5. Names, errors, and comments read as above; no `any`, no new enum, no new default export.
6. The module's or tool's doc, `AGENTS.md`, and the [roadmap](roadmap.md) match the code.
