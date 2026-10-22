import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

/** What `truncate` returns: the text to send, whether it was cut, and where the whole text was saved if so. */
export type Truncated = { text: string; truncated: boolean; fullTextPath?: string };

/**
 * Cuts `text` from the top to pi's limits (50KB / 2000 lines), with a note for the model when it cuts. A cut text is
 * saved whole first, and the note names the file, so the model can `read` the rest. `extension` names the file's
 * type, such as `.md`.
 */
export async function truncate(text: string, extension: string): Promise<Truncated> {
  const result = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!result.truncated) return { text, truncated: false };

  const fullTextPath = await saveFullText(text, extension);
  const where = fullTextPath ? ` The full text is in ${fullTextPath}; read it for the rest.` : "";

  // truncateHead keeps whole lines only, so a first line over the limit, as in minified JSON, would leave nothing.
  if (result.firstLineExceedsLimit) {
    const head = new TextDecoder().decode(new TextEncoder().encode(text).subarray(0, DEFAULT_MAX_BYTES));
    const shown = `showed the first ${formatSize(DEFAULT_MAX_BYTES)} of ${formatSize(result.totalBytes)}`;
    return { text: `${head}\n\n[Truncated: ${shown}.${where}]`, truncated: true, fullTextPath };
  }

  const shown = `showed ${result.outputLines} of ${result.totalLines} lines`;
  return { text: `${result.content}\n\n[Truncated: ${shown}.${where}]`, truncated: true, fullTextPath };
}

/**
 * Writes `text` to a new file in the OS temp directory, readable only by the user, the way pi saves its own tools'
 * full output: `pi-web-fetch-<random hex><extension>`, created with `wx` so it never follows a link someone else put
 * there. `undefined` when it can't be written: the cut text still goes back, only without a path.
 */
async function saveFullText(text: string, extension: string): Promise<string | undefined> {
  const path = join(tmpdir(), `pi-web-fetch-${randomBytes(8).toString("hex")}${extension}`);
  try {
    await writeFile(path, text, { mode: 0o600, flag: "wx" });
    return path;
  } catch {
    return undefined;
  }
}
