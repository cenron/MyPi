/** Prompt section text for each mode; Build replaces Plan instead of dropping it, so the model sees the switch. */
export const PLAN_PROMPT = `You are in plan mode: investigate and plan, but make no changes to the project. Read/search and run read-only commands; don't run mutating commands, and don't edit or write files except plan notes in .pi/plans/.
Explore first, answer what you can, then ask a few focused questions about unresolved decisions.
Once the plan is settled, call submit_plan with a short title and the full plan: the goal, file-by-file changes, and verification steps. Keep refining and submit again if the plan changes, until the user switches to build mode.`;

export const BUILD_PROMPT = `Build mode is active. Implement the agreed plan, or handle the request normally if there isn't one.`;

/** The first message of a session started by `/plan implement`, taken from Codex's plan hand-off. */
export const implementMessage = (
  path: string,
  plan: string,
) => `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

Plan file: ${path}

${plan}`;
