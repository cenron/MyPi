import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerManager } from "#module/lsp/manager";
import { lspEditTool } from "#module/lsp/tools/lsp-edit";
import { fakeSpec, textOrError } from "../fakes";

let dir: string;
let servers: ServerManager | undefined;

// The fake server renames every whole-word use of the name, in every .ts file under the root.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-edit-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(join(dir, "src/server.ts"), "class ServerManager\n  method touch\nfunction main\n  touch(touch)\n");
  await writeFile(join(dir, "src/other.ts"), "// calls touch\n");
});

afterEach(async () => {
  await servers?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

/** Runs a rename in the session folder `cwd`; the text it returns, or the error it throws. */
async function rename(params: Record<string, unknown>, cwd = dir): Promise<string> {
  servers = new ServerManager([fakeSpec()], dir, () => {});
  return textOrError(lspEditTool(servers), { action: "rename", ...params }, cwd);
}

const read = (path: string) => readFile(join(dir, path), "utf8");

describe("lsp_edit rename", () => {
  it("applies the server's edits to every file, and says what changed", async () => {
    const text = await rename({ path: "src/server.ts", name_path: "ServerManager/touch", new_name: "refresh" });
    expect(text).toBe(
      "Renamed ServerManager/touch to refresh: 4 edits in 2 files:\nsrc/other.ts: 1 edit\nsrc/server.ts: 3 edits",
    );
    expect(await read("src/server.ts")).toBe(
      "class ServerManager\n  method refresh\nfunction main\n  refresh(refresh)\n",
    );
    expect(await read("src/other.ts")).toBe("// calls refresh\n");
  });

  it("changes nothing when a file to change is outside the session's folder", async () => {
    await writeFile(join(dir, "lib.ts"), "touch\n");
    const params = { path: "server.ts", name_path: "ServerManager/touch", new_name: "refresh" };
    expect(await rename(params, join(dir, "src"))).toMatch(
      /^ERROR: Renaming ServerManager\/touch would also change files outside .+lib\.ts\. Nothing was changed/,
    );
    expect(await read("src/server.ts")).toContain("method touch");
    expect(await read("lib.ts")).toBe("touch\n");
  });

  it("fails without a new name", async () => {
    expect(await rename({ path: "src/server.ts", name_path: "touch", new_name: " " })).toBe(
      "ERROR: rename needs a new_name.",
    );
  });
});
