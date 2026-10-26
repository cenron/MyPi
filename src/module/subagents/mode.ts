import { ask } from "#core/events";
import type { Session } from "#core/session";

/** Whether plan-build says Plan is on. With plan-build off, nobody answers, which counts as Build. */
export async function isPlanMode(session: Session): Promise<boolean> {
  const answers = await ask(session.pi.events, "mode", undefined);
  return answers.some((answer) => answer.kind === "answer" && answer.value === "plan");
}
