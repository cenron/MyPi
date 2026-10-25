import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { ExtensionCommandContext, SessionManager } from "@earendil-works/pi-coding-agent";
import { errorMessage } from "#core/util/errors";
import { resolveToolPath } from "#core/util/paths";
import { latestPlan } from "../../plan-file";
import { implementMessage } from "../../prompts";

/** `/plan implement`'s plan file: the argument, resolved the way the file tools resolve paths, else the latest plan. */
export async function findPlan(plansDir: string, cwd: string, file: string | undefined): Promise<string> {
  if (file !== undefined) return resolveToolPath(file, cwd, homedir());

  const latest = await latestPlan(plansDir);
  if (latest === undefined) throw new Error(`No plans in ${plansDir}/ to implement`);
  return latest;
}

/**
 * Starts a new session seeded with the plan at `path`. `seed` writes into the new session before its `session_start`
 * (plan-build saves Build there). Returns a message only when nothing changed; after the switch `ctx` is stale.
 */
export async function implementInNewSession(
  ctx: ExtensionCommandContext,
  path: string,
  seed: (sessionManager: SessionManager) => void,
): Promise<string | undefined> {
  const plan = await readFile(path, "utf8");
  // Typed during a run, the command runs at once; the dialog's comes once the run has settled, so this returns.
  await ctx.waitForIdle();

  const result = await ctx.newSession({
    parentSession: ctx.sessionManager.getSessionFile(),
    setup: async (sessionManager) => seed(sessionManager),
    withSession: async (newCtx) => {
      // sendUserMessage resolves when the run ends, so awaiting it would hold the command for the whole run.
      newCtx.sendUserMessage(implementMessage(path, plan)).catch((error: unknown) => {
        if (newCtx.hasUI) newCtx.ui.notify(errorMessage(error), "error");
      });
    },
  });
  return result.cancelled ? "New session cancelled; still in this one." : undefined;
}
