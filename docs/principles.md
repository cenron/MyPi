# Principles

- **Simplicity first.** Build for the need in front of us, not hypothetical ones. Three similar lines beat a premature helper.
- **Small files with clear boundaries.** One concept per file, one folder per module.
- **Composition at the entry point.** `src/index.ts` wires modules. Dependencies come in as arguments, never as globals.
- **Narrative code.** Guard clauses at the top, then orchestrators that read like an outline, with helpers doing the work.
- **Validate at boundaries only.** Check config loading and tool parameters; trust internal code.
- **Idempotent operations.** Running a command or registering something twice must not duplicate or clobber anything.
- **Delete, don't comment out.** No dead code and no compatibility shims.
- **Consistency.** Once a pattern exists, use it everywhere.
- **Verify, don't guess.** Check pi behavior against the installed docs, types, and examples before relying on it.
- **Tests are sacred.** Never change a test just to make it pass. When a test fails, assume the code is wrong until the real behavior is confirmed.
