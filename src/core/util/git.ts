import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isNodeError } from "./errors";

/**
 * Writes a `.gitignore` of `*` in `dir`, so a folder MyPi writes into stays out of git without touching the project's
 * own `.gitignore`. An existing one is kept, whatever it says: editing it is how a project opts back in. `dir` must
 * exist; any error but `EEXIST` is thrown for the caller to report.
 */
export async function keepOutOfGit(dir: string): Promise<void> {
  await writeFile(join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch((error: unknown) => {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  });
}
