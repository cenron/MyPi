import type { EventBus } from "@earendil-works/pi-coding-agent";
import { ask } from "#core/events";

/** True only when a listener answers that Plan is on; no answer means Build. */
export async function isPlanMode(events: EventBus): Promise<boolean> {
  const answers = await ask(events, "mode", undefined);
  return answers.some((answer) => answer.kind === "answer" && answer.value === "plan");
}
