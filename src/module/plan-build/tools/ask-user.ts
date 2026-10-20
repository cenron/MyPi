import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";

export const ASK_USER = "ask_user";

/** The last entry in the list, which opens a text input instead of answering. */
export const OWN_ANSWER = "Type my own answer";

const parameters = Type.Object({
  question: Type.String({ description: "One focused question about a decision the plan needs." }),
  options: Type.Array(
    Type.Object({
      label: Type.String({ description: "A concrete answer, short." }),
      description: Type.Optional(Type.String({ description: "What picking it means, in one line." })),
    }),
    { description: "Likely answers, recommended first. The user can always type their own; pass [] for open text." },
  ),
});

type Details = { answer: string | undefined };

const result = (text: string, answer?: string) => ({
  content: [{ type: "text" as const, text }],
  details: { answer },
});

/**
 * The `ask_user` tool: one question, answered from a list or in the user's own words, through pi's `select` and
 * `input` dialogs. Registered inactive, since only Plan turns it on.
 */
export function askUserTool(): ToolDefinition<typeof parameters, Details> {
  return {
    name: ASK_USER,
    label: "Ask user",
    description:
      "Ask the user one question, with likely answers to pick from; they can also type their own. Use it for " +
      "decisions you can't settle by exploring.",
    promptSnippet: "Ask the user a question with answers to pick from, in plan mode",
    parameters,
    defaultActive: false,
    // Two questions at once would open two dialogs.
    executionMode: "sequential",
    async execute(_toolCallId, { question, options }: Static<typeof parameters>, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) return result("No UI to ask the user. Decide yourself and state the assumption in the plan.");

      // select only takes strings, so a description goes on its option's line, and the answer is mapped back by index.
      const lines = options.map(({ label, description }) => (description ? `${label} — ${description}` : label));
      const picked =
        lines.length === 0 ? OWN_ANSWER : await ctx.ui.select(question, [...lines, OWN_ANSWER], { signal });
      if (picked === undefined) return result("The user dismissed the question without answering.");

      if (picked !== OWN_ANSWER) {
        const answer = options[lines.indexOf(picked)]?.label ?? picked;
        return result(`The user picked: ${answer}`, answer);
      }

      const typed = (await ctx.ui.input(question, undefined, { signal }))?.trim();
      if (!typed) return result("The user dismissed the question without answering.");
      return result(`The user answered: ${typed}`, typed);
    },
  };
}
