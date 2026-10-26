import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { JobManager } from "#core/job-manager";
import type { Command } from "#core/types";
import type { ThinkingLevel } from "#core/util/thinking";
import { isMode, type Mode } from "../../types";
import { findPlan, implementInNewSession } from "./implement";

/** What `/plan` needs from the module: its mode switches, and saving Build into a new session. */
export type PlanCmdActions = {
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  saveBuildTo: (sessionManager: SessionManager, plan: string, thinking: ThinkingLevel) => void;
  getThinkingLevel: () => ThinkingLevel;
  jobs: JobManager;
};

/** `/plan`: toggles the mode, picks one, or implements a plan in a new session. */
export function planCmd(plansDir: string, actions: PlanCmdActions): Command {
  return {
    info: {
      name: "plan",
      description: "Toggle Plan/Build mode (plan|build: pick one; implement [plan file]: in a new session)",
    },
    execute: async (ctx, args) => {
      const [arg, file] = args;

      switch (arg) {
        case "implement": {
          const path = await findPlan(plansDir, ctx.cwd, file);
          return implementInNewSession(ctx, path, actions.jobs, actions.getThinkingLevel, (manager, thinking) =>
            actions.saveBuildTo(manager, path, thinking),
          );
        }

        case undefined:
          actions.toggleMode();
          break;

        default:
          if (!isMode(arg)) throw new Error(`Unknown mode: ${arg} (use plan, build, or implement)`);
          actions.setMode(arg);
      }
    },
  };
}
