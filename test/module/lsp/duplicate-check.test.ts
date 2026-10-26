import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duplicatesIn } from "#module/lsp/duplicate-check";
import { ServerManager } from "#module/lsp/manager";
import { fakeSpec } from "./fakes";

const execute = promisify(execFile);
let dir: string;
let servers: ServerManager | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-duplicates-"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(join(dir, "price.ts"), "function formatPrice\n");
  await execute("git", ["init", "-q"], { cwd: dir });
  await execute("git", ["add", "package.json", "price.ts"], { cwd: dir });
  await execute("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "initial"], {
    cwd: dir,
  });
});

afterEach(async () => {
  await servers?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

describe("duplicatesIn", () => {
  it("synchronizes the server and finds an exact declaration in another tracked project file", async () => {
    const file = join(dir, "cart.ts");
    await writeFile(file, "function formatPrice\n");
    servers = new ServerManager([fakeSpec()], dir, () => {});

    expect(await duplicatesIn(servers, [file], vi.fn())).toEqual([
      { name: "formatPrice", file, line: 1, elsewhere: { file: join(dir, "price.ts"), line: 1 } },
    ]);
  });

  // Seen live: imported helpers were reported as duplicates of themselves.
  it("doesn't report a name the file only imports", async () => {
    const file = join(dir, "cart.ts");
    await writeFile(file, "import formatPrice\n");
    servers = new ServerManager([fakeSpec()], dir, () => {});

    expect(await duplicatesIn(servers, [file], vi.fn())).toEqual([]);
  });
});
