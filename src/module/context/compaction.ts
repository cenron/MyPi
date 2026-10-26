import {
  compact,
  type ExtensionContext,
  type SessionBeforeCompactEvent,
  type SessionBeforeCompactResult,
} from "@earendil-works/pi-coding-agent";
import { errorMessage } from "#core/util/errors";

/** What MyPi needs a summary to carry on with, added after the user's own `/compact` text. */
const SUMMARY_INSTRUCTIONS = `Keep every decision the user made and why; the plan file being implemented, if any; files changed and still to change; open questions; and the next step. Do not keep file contents or tool output, which can be read again. Messages that start with "Done check" (MyPi's automatic check when a run ends) or "Background job" or "Subagent job" (its job notices) are MyPi's, not the user's words: never write "the user asked" or "the user reports" for them.`;

/**
 * pi's own summary, with MyPi's instructions after the user's `/compact` text. pi's hook can only replace the whole
 * summary, so MyPi calls pi's `compact` itself. On any failure it warns and returns nothing: pi then compacts as usual.
 */
export async function steerCompaction(
  event: SessionBeforeCompactEvent,
  ctx: ExtensionContext,
  warn: (message: string) => void,
): Promise<SessionBeforeCompactResult | undefined> {
  const model = ctx.model;
  if (!model) return undefined;

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) throw new Error(auth.error);

    const instructions = [event.customInstructions, SUMMARY_INSTRUCTIONS].filter(Boolean).join("\n\n");
    // No thinking level or stream function of our own: `compact` uses pi's defaults for those.
    const result = await compact(
      event.preparation,
      model,
      auth.apiKey,
      setHeaders(auth.headers),
      instructions,
      event.signal,
      undefined,
      undefined,
      auth.env,
    );
    return { compaction: result };
  } catch (error) {
    warn(`MyPi couldn't steer this compaction: ${errorMessage(error)}; pi summarized without its instructions.`);
    return undefined;
  }
}

/** pi's headers use `null` to mean "remove this header"; `compact` takes only the ones that are set. */
function setHeaders(headers: Record<string, string | null> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;

  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== null));
}
