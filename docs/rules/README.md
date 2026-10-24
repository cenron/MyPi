# Rules

MyPi's own tool rules: checks the tool guard runs on every tool call, next to the rules modules add with
`BaseModule.onToolCall`. They're core, so they're always on. The code is in `src/rule/`, one file per rule. Each
extends `BaseRule` (`base.ts`), like modules extend `BaseModule`: an `info` getter (`name`, the prefix of its
questions, and `description`) and a `check(call, env)` that returns a `Verdict`. Rules are listed in `createRules`
(`src/rule/index.ts`), and `registerRules` sets them on each session's guard.

Every rule gets the session's one `PromptPaths` (`rule.prompt.paths`): the skill folders and context files pi listed
in the prompt, the places outside the folder pi itself points the agent at. pi hands them over only in
`before_agent_start`, so `MyPi.onBeforeAgentStart` calls `updatePromptPaths` (`index.ts`), which fills them once;
they only change on `/reload`, which starts a new session with new rules. How the guard combines rules
(any block wins, asks share one dialog, "Allow for this session") is in [architecture](../architecture.md).

| Rule | Status | Summary |
|---|---|---|
| [folder-guard](folder-guard.md) | building | Ask before any tool call reaches outside the session's folder, in Plan and Build; "Allow for this session" per path |
