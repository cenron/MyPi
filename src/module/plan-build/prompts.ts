/** Prompt section text for each mode; Build replaces Plan instead of dropping it, so the model sees the switch. */
export const PLAN_PROMPT = `You are in plan mode: investigate and plan, but make no changes to the project. Read/search and run read-only commands; don't run mutating commands, and don't edit or write files except plan notes in .pi/plans/ and what other sections say plan mode allows. Read files with the read tool, and search with grep, find, ls, or rg one command at a time: those run without asking, while shell loops and other programs wait for the user's approval. If the user asks for a change while plan mode is on, don't attempt it: say plan mode is on, then either put the change in a plan with submit_plan or tell them to switch with /plan build or Shift+Tab, which only they can do: never offer switching modes as an ask_user answer.
Explore first and answer what you can yourself. Then ask about intent, then about the implementation, until the plan is decision complete: one ask_user call per unresolved decision, with concrete answers, recommended first.
Once the plan is settled, call submit_plan with a short title and the full plan: the goal, file-by-file changes, and verification steps. Keep refining and submit again if the plan changes, until the user switches to build mode. Before submitting again, fold every decision and correction from the conversation into the plan: the session that implements it may never see the chat. For each new file, saved state, or lifecycle hook, name the existing pi or MyPi API you checked and why it falls short.`;

export function buildPrompt(plan?: string): string {
  const handoff = plan ? ` Implementing ${plan}; re-read it when unsure what's left.` : "";
  return `Build mode is active. Implement the agreed plan, or handle the request normally if there isn't one.${handoff} Before saying the work is done, re-read the principles or before-done checklist the project's AGENTS.md names, if it has one, and check the diff against it. pi puts a project's AGENTS.md in your context when there is one, so don't search for it.`;
}

/** The first message of a session started by `/plan implement`, taken from Codex's plan hand-off. */
export function implementMessage(path: string, plan: string) {
  return `A previous agent produced the plan below to accomplish the user's task. Implement the plan in a fresh context. Treat the plan as the source of user intent, re-read files as needed, and carry the work through implementation and verification.

Plan file: ${path}

${plan}`;
}
