import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import type { JobManager } from "#core/job-manager";
import { errorMessage } from "#core/util/errors";
import { resolveToolPath } from "#core/util/paths";
import type { ThinkingLevel } from "#core/util/thinking";
import { latestPlan } from "../../plan-file";
import { implementMessage } from "../../prompts";

/** What `/plan implement` carries into the new session: the thinking level, and the model as `provider/id`. */
export type CarriedSettings = { thinking: ThinkingLevel; model?: string };

/** `/plan implement`'s plan file: the argument, resolved the way the file tools resolve paths, else the latest plan. */
export async function findPlan(plansDir: string, cwd: string, file: string | undefined): Promise<string> {
  if (file !== undefined) return resolveToolPath(file, cwd, homedir());

  const latest = await latestPlan(plansDir);
  if (latest === undefined) throw new Error(`No plans in ${plansDir}/ to implement`);
  return latest;
}

/**
 * Starts a new session seeded with the plan at `path`. `seed` writes into the new session before its `session_start`
 * (plan-build saves Build there, with the thinking level and model it carries). Returns a message only when nothing changed; after the switch `ctx` is stale.
 */
export async function implementInNewSession(
  ctx: ExtensionCommandContext,
  path: string,
  jobs: JobManager,
  getThinkingLevel: () => ThinkingLevel,
  seed: (sessionManager: SessionManager, carried: CarriedSettings) => void,
): Promise<string | undefined> {
  const plan = await readFile(path, "utf8");
  // A new session starts on the settings' default model, so the one picked here goes along, as the thinking level does.
  const carried: CarriedSettings = {
    thinking: getThinkingLevel(),
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
  };
  // Typed during a run, the command runs at once; the dialog's comes once the run has settled, so this returns.
  await ctx.waitForIdle();
  jobs.requireNoneRunning();

  const result = await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async (sessionManager) => seed(sessionManager, carried),
    withSession: async (newCtx) => {
      // sendUserMessage resolves when the run ends, so awaiting it would hold the command for the whole run.
      newCtx.sendUserMessage(implementMessage(path, plan)).catch((error: unknown) => {
        if (newCtx.hasUI) newCtx.ui.notify(errorMessage(error), "error");
      });
    },
  });
  return result.cancelled ? "New session cancelled; still in this one." : undefined;
}
