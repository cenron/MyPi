# Quiet

**Status: done.** Quiet is an `ON_LOAD` module that draws each tool call as one short status line, with pi's spacer above
it. `/quiet` toggles it for this session; it is off at every session start and saves no state. `/modules` can turn the
module off.

While Quiet is on, calls in progress show a muted `…`, successful calls a green `✓` and muted summary, and failures a
red `✗`, a normal-color summary and a short reason. Failed output remains visible through the tool's own renderer;
when a tool has no custom result renderer, pi's built-in result stays in place. `Ctrl+O` expands tool rows as usual.
The yellow `QUIET` footer label is present only while the module is on.

Quiet wraps pi's `registerToolRenderer` resolver and the renderers supplied by pi and MyPi. It returns
`renderShell: "self"` while active, removing the padded box; pi's `ToolExecutionComponent` still adds a spacer above
its content, so the status line is the second line of the row. `Ctrl+O` switches existing rows back to pi's default
shell and delegates their call and result renderers; new rows created while expanded, and all rows when Quiet is off,
use the next renderer unchanged. Radian's Calm inspired the resolver seam, but Quiet also replaces the call/result drawing.

The renderer investigation found that pi 1.4.0 always adds `Spacer(1)` above a tool row. The default renderer shell
adds a padded `Box`; the supported `renderShell: "self"` choice removes that box but can't remove the spacer. There is
no supported extension API to toggle `hideThinkingBlock`: `Ctrl+T` (`app.thinking.toggle`) remains available, and
Quiet's on-message says so. Thinking blocks therefore remain visible unless the user collapses them.
