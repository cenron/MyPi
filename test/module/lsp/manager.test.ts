import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspClient } from "#module/lsp/client";
import { ServerManager } from "#module/lsp/manager";
import type { ServerSpec } from "#module/lsp/servers";
import { fakeSpec } from "./fakes";

let dir: string;
let manager: ServerManager | undefined;
const warn = vi.fn<(message: string) => void>();

// dir/a and dir/b are two projects, each with a package.json.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-"));
  for (const project of ["a", "b"]) {
    await mkdir(join(dir, project));
    await writeFile(join(dir, project, "package.json"), "{}");
  }
  warn.mockClear();
});

afterEach(async () => {
  await manager?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

function create(...specs: ServerSpec[]) {
  manager = new ServerManager(specs, dir, warn);
  return manager;
}

const file = (path: string) => join(dir, path);
const status = (servers: ServerManager) => servers.statuses()[0];

describe("ServerManager", () => {
  it("starts one server per root, however many files are touched", async () => {
    const servers = create(fakeSpec());
    await Promise.all([servers.touch(file("a/x.ts")), servers.touch(file("a/y.ts")), servers.touch(file("b/z.ts"))]);
    expect(status(servers)?.running).toEqual([file("a"), file("b")]);
  });

  it.each([
    ["the nearest marked folder", {}, "a/inner"],
    ["the outermost marked folder with outermostRoot", { outermostRoot: true }, "a"],
  ])("roots a server at %s", async (_case, overrides, root) => {
    await mkdir(join(dir, "a/inner"));
    await writeFile(join(dir, "a/inner/package.json"), "{}");

    const servers = create(fakeSpec("ok", overrides));
    await servers.touch(file("a/inner/x.ts"));
    expect(status(servers)?.running).toEqual([file(root)]);
  });

  it.each([
    ["a file no server serves", fakeSpec(), "a/x.md"],
    ["a server that isn't installed", fakeSpec("ok", { command: "/nonexistent/server" }), "a/x.ts"],
  ])("starts nothing for %s", async (_case, spec, path) => {
    const servers = create(spec);
    await servers.touch(file(path));
    expect(status(servers)).toMatchObject({ running: [], starting: [], failed: [] });
  });

  it("starts nothing for a server that's off, and stops it when turned off", async () => {
    const servers = create(fakeSpec());
    await servers.touch(file("a/x.ts"));
    await servers.setOff(["fake"]);
    expect(status(servers)).toMatchObject({ on: false, running: [] });

    await servers.touch(file("a/x.ts"));
    expect(status(servers)?.running).toEqual([]);
  });

  it("warns once on a failed start, and retries only after setOff", async () => {
    const servers = create(fakeSpec("crash"));
    await servers.touch(file("a/x.ts"));
    await servers.touch(file("a/x.ts"));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("Fake server failed to start in");
    expect(status(servers)?.failed).toEqual([{ root: file("a"), error: expect.stringContaining("boom") }]);

    await servers.setOff([]);
    expect(status(servers)?.failed).toEqual([]);
    await servers.touch(file("a/x.ts"));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stops a server that finishes starting after it was turned off", async () => {
    const stop = vi.spyOn(LspClient.prototype, "stop");
    const servers = create(fakeSpec());
    const touched = servers.touch(file("a/x.ts"));
    expect(status(servers)?.starting).toEqual([file("a")]);

    await servers.setOff(["fake"]);
    await touched;
    expect(status(servers)).toMatchObject({ running: [], starting: [] });
    expect(stop).toHaveBeenCalledOnce();
    stop.mockRestore();
  });

  it("drops a server that exits on its own, with a warning", async () => {
    const servers = create(fakeSpec("die"));
    await servers.touch(file("a/x.ts"));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("exited")));
    expect(status(servers)?.running).toEqual([]);
  });

  it("stops everything on stopAll and starts nothing after", async () => {
    const servers = create(fakeSpec());
    await servers.touch(file("a/x.ts"));
    await servers.stopAll();
    await servers.touch(file("b/x.ts"));
    expect(status(servers)?.running).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
