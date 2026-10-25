/** plan-build's two modes. */
export const Mode = {
  PLAN: "plan",
  BUILD: "build",
} as const;

/** One of plan-build's modes: `"plan"` or `"build"`. */
export type Mode = (typeof Mode)[keyof typeof Mode];

/** A plan the model submitted with `submit_plan`, and where it was saved. */
export type SubmittedPlan = { title: string; plan: string; path: string };

/** What a dialog choice may do, kept narrow so a choice never needs the whole module. */
export type PlanActions = {
  switchToBuild: (plan: string) => void;
  sendUserMessage: (text: string) => void;
  implementInNewSession: (plan: SubmittedPlan) => void;
};

/** One choice in the "Implement this plan?" dialog. `label` is shown by `ctx.ui.select` and must be unique. */
export type PlanChoice = {
  label: string;
  run: (plan: SubmittedPlan, actions: PlanActions) => void;
};

/** True when `value` is a mode; checks a mode read from the session file or typed after `/plan`. */
export function isMode(value: unknown): value is Mode {
  return (Object.values(Mode) as unknown[]).includes(value);
}
