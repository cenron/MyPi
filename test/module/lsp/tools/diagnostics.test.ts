import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerManager } from "#module/lsp/manager";
import { lspTool } from "#module/lsp/tools/lsp";
import { fakeSpec } from "../fakes";

let dir: string;
let servers: ServerManager | undefined;

// The fake server reports a line holding `ERROR <text>` or `WARN <text>` as a problem.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-diag-"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(join(dir, "bad.ts"), "function main\n  WARN unused y\n  ERROR Cannot find name x\n");
});

afterEach(async () => {
  await servers?.stopAll();
  servers = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** The diagnostics action's text from a server that pushes them, or pulls them in `mode` "pull". */
async function diagnose(file: string, mode = "ok"): Promise<string> {
  servers ??= new ServerManager([fakeSpec(mode)], dir, () => {});
  const result = await lspTool(servers).execute("1", { action: "diagnostics", path: file }, undefined, undefined, {
    cwd: dir,
  } as never);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
}

const BAD = [
  "2 problems (1 error, 1 warning) in bad.ts, from the Fake server:",
  "error 3:3  Cannot find name x (fake 7)",
  "warning 2:3  unused y (fake 7)",
].join("\n");

describe("lsp diagnostics", () => {
  it.each([
    ["pushes them", "ok"],
    ["is asked for them", "pull"],
  ])("lists a file's problems, worst first, from a server that %s", async (_case, mode) => {
    expect(await diagnose("bad.ts", mode)).toBe(BAD);
  });

  // A push for the old text must not answer for the new one.
  it("answers for the file as it is on disk now", async () => {
    expect(await diagnose("bad.ts")).toBe(BAD);
    await writeFile(join(dir, "bad.ts"), "function main\n");
    expect(await diagnose("bad.ts")).toBe("No problems in bad.ts, from the Fake server.");
  });
});
