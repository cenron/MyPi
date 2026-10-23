import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { savePlan } from "../plan-file";
import type { SubmittedPlan } from "../types";

export const SUBMIT_PLAN = "submit_plan";

const parameters = Type.Object({
  title: Type.String({ description: "A short title for the plan; it names the plan file." }),
  plan: Type.String({
    description: "The full plan in markdown: goal, file-by-file changes, and verification. Don't repeat the title.",
  }),
});

/**
 * The `submit_plan` tool: saves the plan to `.pi/plans/` and hands it to `onSubmit`. Registered inactive, since only
 * Plan turns it on.
 */
export function submitPlanTool(
  onSubmit: (plan: SubmittedPlan) => void,
): ToolDefinition<typeof parameters, { path: string }> {
  return {
    name: SUBMIT_PLAN,
    label: "Submit plan",
    description:
      "Submit the finished, decision-complete plan. It's saved to .pi/plans/ and offered to the user to implement.",
    promptSnippet: "Submit the finished plan in plan mode",
    parameters,
    defaultActive: false,
    async execute(_toolCallId, { title, plan }, _signal, _onUpdate, ctx) {
      const path = await savePlan(ctx.cwd, title, plan, new Date());
      onSubmit({ title, plan, path });
      return { content: [{ type: "text", text: `Plan saved to ${path}.` }], details: { path } };
    },
  };
}
