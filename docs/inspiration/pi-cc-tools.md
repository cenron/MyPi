# pi-cc-tools (pi-claude-code-ui)

A pi package that makes pi look like Claude Code: tool calls folded into one-line summaries, syntax-highlighted
diffs for every edit, a spinner that names what's running, collapsed thinking, and colors from the terminal's own
theme.

- **Repository:** [FammasMaz/pi-cc-tools](https://github.com/FammasMaz/pi-cc-tools), commit `10b1675`
  (2026-10-26), read 2026-10-26. Published on npm as `pi-claude-code-ui` 1.0.102.
- **License:** MIT (in `package.json` and on npm; the repository has no license file).
- **Feeds:** the nice-to-have "Themes: colors and layouts" on the [roadmap](../roadmap.md#nice-to-have).

## What it does

- **Tool rows:** consecutive tool calls collapse into one sentence (`Read 2 files, ran 1 shell command`), with
  `Reading 2 files… · 3s` while they run, a dot that turns red on a failure, and `Ctrl+O` (or a click in fullscreen
  mode) to expand every call and its output. The same row layout for built-in, MCP, and custom tools.
- **Diffs:** `edit` and `write` show a diff with syntax highlighting (shiki) and word-level marks, side by side on
  wide terminals. Shell commands that only change files (`sed -i`, heredocs, `tee`, `echo > file`) are drawn as edits
  too, with a diff of what changed on disk; the command and its output to the model are unchanged.
- **Spinner:** names the tool running (`Running npm test…`, `Waiting for agent: …`), a playful verb while thinking,
  and a token count that counts up as text streams.
- **Thinking:** `live` (collapses to `Thought for 3s`), `full`, or `latest` (only the latest message keeps it; drawing
  only, the model still sees it).
- **Colors from the terminal:** on pi 1.4+, switches to pi's built-in `system` theme, built from the palette the
  terminal reports, and re-reads it on focus; its own colors derive from the active theme.
- **Smaller:** past prompts as one highlighted `❯` line, the same marker on the input line, LaTeX as Unicode, a
  quiet "Turn took 6s" line.
- **Settings:** about 20 keys in `settings.json` and `/cc-tools`, `/cc-theme`, `/cc-spinner` commands.

## How it's built

- One 9,144-line extension file plus helpers; dependencies `shiki` and `diff`.
- It **re-registers pi's built-in tools under the same names** (`createReadTool(cwd)` and friends, wrapped with new
  `renderCall`/`renderResult`), re-registers every other tool to wrap its drawing, and uses pi's exported components
  (`ToolExecutionComponent`, `AssistantMessageComponent`, `UserMessageComponent`, `CustomEditor`) and `setTheme`.

## What MyPi could build from it

Post-MVP, as the [theme picker](../roadmap.md#nice-to-have): a menu to switch between themes, each a module of colors
**and** layout that can be added or removed.

- **The look**, as a first layout theme ("Claude Code"; Codex or Gemini themes could follow): the `❯` prompt line,
  dots and connectors on tool rows, grouped calls, collapsed thinking, diffs on edits, a spinner that names the tool.
  MyPi already draws some of this its own way: the todo widget, `activeForm` beside the spinner, the jobs line.
- **Following the terminal's colors**, once MyPi's pinned pi is 1.4 or newer (it's 1.2.0).
- **A lesson in how not to hook in:** it replaces tools by name to restyle them, which would collide with any other
  part that registers the same tool (MyPi's `bash`). pi 1.2.0 has a cleaner seam: `pi.registerToolRenderer(resolver)`
  chooses how calls to *any* tool are drawn (registered or not), chained with `next()`, so a theme can restyle
  built-in, MCP, and MyPi tools without owning them. With `setFooter`, `setHeader`, `setEditorComponent`,
  `setWorkingIndicator`, `setWidget`, entry renderers, and `setTheme`, that covers most of what a layout theme needs.
  To check when it's designed: whether grouping consecutive calls into one row works through these seams.
- **Size:** one 9,144-line file with about 20 settings; a MyPi theme would be small parts behind one seam, each theme
  its own folder.

## Also looked at

- [pi-vs-claude-code](pi-vs-claude-code.md): a theme switcher, footers replaced whole, and a colour language, under
  its "UI parts"; its other features are recorded there apart from the theme work.
