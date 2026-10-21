# apply_patch

**Status:** idea

## Goal

Edit several files in one call with a patch: add, delete, update, and rename files together. GPT models are trained on
Codex's patch format, so they edit more reliably with it than with pi's `edit` (exact string replace, one file per
call). Pi 1.2.0 has no patch tool.

## Other harnesses

| Harness | Tool | Notes |
|---|---|---|
| Codex CLI | `apply_patch` | The format below. The tool every Codex model edits with. |
| OpenCode | `patch` | The same format, with the same description text. |
| Claude Code | None | `Edit` and `Write` only. |

### The format

```
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch
```

- An envelope, `*** Begin Patch` … `*** End Patch`, around one or more file sections.
- Each section starts with `*** Add File: <path>`, `*** Delete File: <path>`, or `*** Update File: <path>`.
- Add: every line is a `+` line (the new contents). Delete: nothing follows. Update: an optional `*** Move to:
  <path>`, then hunks.
- A hunk starts with `@@`, optionally followed by a line to anchor on (a function or class header). Lines are ` `
  (context), `-` (remove), or `+` (add). No line numbers. `*** End of File` marks a hunk that ends at the end of the
  file.

### How Codex finds a hunk

`codex-rs/apply-patch/src/seek_sequence.rs` looks for the hunk's context and `-` lines, from strict to lenient, and
takes the first match:

1. Exact match.
2. Ignoring trailing whitespace.
3. Ignoring leading and trailing whitespace.
4. After turning common Unicode punctuation (curly quotes, dashes) into ASCII.

With `*** End of File`, it tries the end of the file first.

## Behavior

- One call, many files: add, delete, update, rename.
- All or nothing: every hunk is checked against the files before anything is written.
- An error names the file and the hunk that didn't match, so the model can retry with more context.
- Not allowed in Plan mode, except under `.pi/plans/`, the same as `write` and `edit`.

## Design in pi

| Piece | pi hook | Notes |
|---|---|---|
| Tool | A folder, `src/tool/apply-patch/`, listed in `createTools` | One string parameter, `patch`. `annotations: { destructiveHint: true }`. |
| Parser | Pure function, patch text → file operations | Tested against the examples in Codex's tests. |
| Matcher | Pure function, Codex's four passes | Tested on its own. |
| Writing | `withFileMutationQueue(path, fn)` from pi | pi's own write and edit tools use it to serialize writes to the same file. Paths through `resolveToolPath` (`src/core/util/paths.ts`). |
| Plan mode | plan-build's rule must read the paths out of the patch | Today it checks `write`/`edit` paths only. |
| Rendering | `renderCall` / `renderResult` | A diff per file, like pi's edit renderer. |

## Slices

1. The parser, with tests.
2. The matcher, with tests.
3. The tool: check every hunk, then write, all or nothing.
4. Plan-build's rule for patch paths.
5. Rendering.

## Open questions

- Always on, or only for models trained on it (GPT), swapping it with `edit`/`write` through `setActiveTools` when
  the model changes?
- Name: `apply_patch` (Codex, what GPT models expect) or `patch` (OpenCode)?
- Port Codex's parser and matcher (Rust, Apache-2.0) to TypeScript, or start from OpenCode's TypeScript (MIT)?

## References

- pi: `withFileMutationQueue` and `createEditToolDefinition` (exported from the package), `examples/extensions/tool-override.ts`
- Codex (`openai/codex`, `main`): `codex-rs/apply-patch/src/{parser,seek_sequence,lib}.rs`
- OpenCode (`anomalyco/opencode`, `dev`): `packages/core/src/tool/plugin/patch.ts`, `packages/core/src/tool/patch.txt`
