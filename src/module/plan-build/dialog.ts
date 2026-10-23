import { relative } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanActions, PlanChoice, SubmittedPlan } from "./types";

const IMPLEMENT_MESSAGE = "Implement the plan.";

/** The choices in order; the first is highlighted, so Implement goes first. Escape stays, like the last one. */
const PLAN_CHOICES: PlanChoice[] = [
  {
    label: "Implement",
    run: (_plan, actions) => {
      actions.switchToBuild();
      actions.sendUserMessage(IMPLEMENT_MESSAGE);
    },
  },
  { label: "Clear context and implement", run: (plan, actions) => actions.implementInNewSession(plan) },
  { label: "Stay in plan mode", run: () => {} },
];

/** Asks what to do with `plan` and runs the chosen choice; Escape or an abort runs nothing. */
export async function offerPlan(ctx: ExtensionContext, plan: SubmittedPlan, actions: PlanActions): Promise<void> {
  const title = `Implement this plan?\n${plan.title} (${relative(ctx.cwd, plan.path)})`;
  const label = await ctx.ui.select(
    title,
    PLAN_CHOICES.map((choice) => choice.label),
    { signal: ctx.signal },
  );
  PLAN_CHOICES.find((choice) => choice.label === label)?.run(plan, actions);
}
