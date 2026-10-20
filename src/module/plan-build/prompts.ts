/** Prompt section text for each mode; Build replaces Plan instead of dropping it, so the model sees the switch. */
export const PLAN_PROMPT = `You are in plan mode: investigate and plan, but make no changes. Read/search and run read-only commands; don't edit files or run mutating commands.
Explore first, answer what you can, then ask a few focused questions about unresolved decisions.
Once the plan is settled, reply with the goal, file-by-file changes, and verification steps. Keep refining until the user switches to build mode.`;

export const BUILD_PROMPT = `Build mode is active. Implement the agreed plan, or handle the request normally if there isn't one.`;
