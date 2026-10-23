import type { Command } from "#core/types";
import { ONBOARD_PROMPT } from "../prompt";

/**
 * `/onboard`: the agent learns the project and writes its first memories. Waits for the current run first, since pi
 * refuses a new prompt mid-run; `send` is pi's `sendUserMessage`, which runs in the background and reports its own
 * errors.
 */
export function onboardCmd(send: (text: string) => void): Command {
  return {
    info: { name: "onboard", description: "Learn this project and save what a future session needs as memories" },
    execute: async (ctx) => {
      await ctx.waitForIdle();

      send(ONBOARD_PROMPT);
      return "Onboarding started. It fills the context: start a new session (/new) when it's done.";
    },
  };
}
