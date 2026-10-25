/** Prompt section text for each mode; Build replaces Plan instead of dropping it, so the model sees the switch. */
export const PLAN_PROMPT = `You are in plan mode: investigate and plan, but make no changes to the project. Read/search and run read-only commands; don't run mutating commands, and don't edit or write files except plan notes in .pi/plans/ and what other sections say plan mode allows.
Explore first and answer what you can yourself. Then ask about intent, then about the implementation, until the plan is decision complete: one ask_user call per unresolved decision, with concrete answers, recommended first.
Once the plan is settled, call submit_plan with a short title and the full plan: the goal, file-by-file changes, and verification steps. Keep refining and submit again if the plan changes, until the user switches to build mode. Before submitting again, fold every decision and correction from the conversation into the plan: the session that implements it may never see the chat. For each new file, saved state, or lifecycle hook, name the existing pi or MyPi API you checked and why it falls short.`;

export function buildPrompt(plan?: string): string {
  const handoff = plan ? ` Implementing ${plan}; re-read it when unsure what's left.` : "";
  return `Build mode is active. Implement the agreed plan, or handle the request normally if there isn't one.${handoff} Before saying the work is done, re-read the project's principles or before-done checklist named in AGENTS.md and check the diff against it.`;
}

/** The first message of a session started by `/plan implement`, taken from Codex's plan hand-off. */
export function implementMessage(path: string, plan: string) {
  return `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

Plan file: ${path}

${plan}`;
}
