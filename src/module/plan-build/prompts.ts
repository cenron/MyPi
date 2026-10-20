/** Prompt section text for each mode; Build replaces Plan instead of dropping it, so the model sees the switch. */
export const PLAN_PROMPT = `You are in plan mode: investigate and plan, but make no changes to the project. Read/search and run read-only commands; don't run mutating commands, and don't edit or write files except plan notes in .pi/plans/.
Explore first, answer what you can, then ask a few focused questions about unresolved decisions.
Once the plan is settled, call submit_plan with a short title and the full plan: the goal, file-by-file changes, and verification steps. Keep refining and submit again if the plan changes, until the user switches to build mode.`;

export const BUILD_PROMPT = `Build mode is active. Implement the agreed plan, or handle the request normally if there isn't one.`;
