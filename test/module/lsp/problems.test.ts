import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerManager } from "#module/lsp/manager";
import { problemsIn } from "#module/lsp/problems";
import { fakeSpec } from "./fakes";

let dir: string;
let servers: ServerManager | undefined;

// The fake server reports a line holding `ERROR <text>` or `WARN <text>` as a problem.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-problems-"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(join(dir, "bad.ts"), "function main\n  ERROR Cannot find name x\n");
  await writeFile(join(dir, "notes.md"), "ERROR not code\n");
});

afterEach(async () => {
  await servers?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

const file = (name: string) => join(dir, name);

describe("problemsIn", () => {
  it("gives each served file's problems, 1-based, and skips files no server serves", async () => {
    servers = new ServerManager([fakeSpec()], dir, () => {});
    expect(await problemsIn(servers, [file("bad.ts"), file("notes.md")], vi.fn())).toEqual([
      {
        file: file("bad.ts"),
        line: 2,
        column: 3,
        severity: "error",
        message: "Cannot find name x",
        origin: "fake 7",
      },
    ]);
  });

  it("brings each server up to date with the disk once, before its first file", async () => {
    await writeFile(file("other.ts"), "");
    servers = new ServerManager([fakeSpec()], dir, () => {});
    const report = vi.spyOn(servers, "reportDiskChanges");
    await problemsIn(servers, [file("bad.ts"), file("other.ts")], vi.fn());
    expect(report).toHaveBeenCalledOnce();
  });

  it("skips a file that's gone since it was listed", async () => {
    servers = new ServerManager([fakeSpec()], dir, () => {});
    expect(await problemsIn(servers, [file("gone.ts")], vi.fn())).toEqual([]);
  });

  it("skips files whose server can't run, saying why", async () => {
    servers = new ServerManager([fakeSpec("ok", { command: "/nonexistent/x" })], dir, () => {});
    const unavailable = vi.fn();
    expect(await problemsIn(servers, [file("bad.ts")], unavailable)).toEqual([]);
    expect(unavailable).toHaveBeenCalledWith(expect.objectContaining({ kind: "missing" }), ".ts");
  });
});
