import { RUN_TIMEOUT_MINUTES } from "../child";
import type { WriterResult } from "../writer";

/** The model's text for a result: the answer, usage, session file, and files or patch the writer changed. */
export function formatResult(result: WriterResult): string {
  return [
    result.timedOut ? `Stopped at the ${RUN_TIMEOUT_MINUTES}-minute limit; the answer may be incomplete.` : undefined,
    result.stopped ? "Writer stopped; partial work was captured." : undefined,
    result.failure && !result.stopped ? `Writer failed: ${result.failure}` : undefined,
    result.answer,
    `Usage: ${result.usage.tokens} tokens, $${result.usage.cost.toFixed(4)}`,
    `Session: ${result.sessionFile ?? "not saved"}`,
    result.patchName
      ? `Patch: ${result.patchName} (${result.changedFiles.join(", ")}). Review it, then call subagent_apply with name \`${result.patchName}\`.`
      : undefined,
    result.inPlace ? "This writer ran in place because the project is not a git repository." : undefined,
    `Changed files: ${result.changedFiles.length ? result.changedFiles.join(", ") : "none"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
