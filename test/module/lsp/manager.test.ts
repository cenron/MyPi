import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileChangeType } from "vscode-languageserver-protocol/node";
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
  it("starts one server per root, shared by every file and caller in it", async () => {
    const servers = create(fakeSpec());
    const [x, y, z] = await Promise.all([
      servers.clientFor(file("a/x.ts")),
      servers.clientFor(file("a/y.ts")),
      servers.clientFor(file("b/z.ts")),
    ]);

    expect(status(servers)?.running).toEqual([file("a"), file("b")]);
    expect(x).toMatchObject({ kind: "ready", root: file("a") });
    expect(x?.kind === "ready" && y?.kind === "ready" && x.client === y.client).toBe(true);
    expect(z).toMatchObject({ kind: "ready", root: file("b") });
  });

  it.each([
    ["the nearest marked folder", {}, "a/inner"],
    ["the outermost marked folder with outermostRoot", { outermostRoot: true }, "a"],
  ])("roots a server at %s", async (_case, overrides, root) => {
    await mkdir(join(dir, "a/inner"));
    await writeFile(join(dir, "a/inner/package.json"), "{}");

    const servers = create(fakeSpec("ok", overrides));
    await servers.clientFor(file("a/inner/x.ts"));
    expect(status(servers)?.running).toEqual([file(root)]);
  });

  it.each([
    ["no_server for a file no server serves", fakeSpec(), "a/x.md", { kind: "no_server", extension: ".md" }],
    [
      "missing for a server that isn't installed",
      fakeSpec("ok", { command: "/nonexistent/x" }),
      "a/x.ts",
      { kind: "missing" },
    ],
  ])("says %s, and starts nothing", async (_case, spec, path, lookup) => {
    const servers = create(spec);
    expect(await servers.clientFor(file(path))).toMatchObject(lookup);
    expect(status(servers)).toMatchObject({ running: [], starting: [], failed: [] });
  });

  it("says off for a server that's off, and stops it when turned off", async () => {
    const servers = create(fakeSpec());
    await servers.clientFor(file("a/x.ts"));
    await servers.setOff(["fake"]);
    expect(status(servers)).toMatchObject({ on: false, running: [] });

    expect(await servers.clientFor(file("a/x.ts"))).toMatchObject({ kind: "off" });
    expect(status(servers)?.running).toEqual([]);
  });

  it("warns once on a failed start, says failed until setOff, then retries", async () => {
    const servers = create(fakeSpec("crash"));
    await servers.clientFor(file("a/x.ts"));
    const again = await servers.clientFor(file("a/x.ts"));

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain("Fake server failed to start in");
    expect(again).toMatchObject({ kind: "failed", root: file("a"), error: expect.stringContaining("boom") });
    expect(status(servers)?.failed).toEqual([{ root: file("a"), error: expect.stringContaining("boom") }]);

    await servers.setOff([]);
    expect(status(servers)?.failed).toEqual([]);
    await servers.clientFor(file("a/x.ts"));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("stops a server that finishes starting after it was turned off, and says off", async () => {
    const stop = vi.spyOn(LspClient.prototype, "stop");
    const servers = create(fakeSpec());
    const asked = servers.clientFor(file("a/x.ts"));
    expect(status(servers)?.starting).toEqual([file("a")]);

    await servers.setOff(["fake"]);
    expect(await asked).toMatchObject({ kind: "off" });
    expect(status(servers)).toMatchObject({ running: [], starting: [] });
    expect(stop).toHaveBeenCalledOnce();
    stop.mockRestore();
  });

  it("drops a server that exits on its own, with a warning", async () => {
    const servers = create(fakeSpec("die"));
    await servers.clientFor(file("a/x.ts"));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("exited")));
    expect(status(servers)?.running).toEqual([]);
  });

  it("stops everything on stopAll and says stopped after", async () => {
    const servers = create(fakeSpec());
    await servers.clientFor(file("a/x.ts"));
    await servers.stopAll();
    expect(await servers.clientFor(file("b/x.ts"))).toMatchObject({ kind: "stopped" });
    expect(status(servers)?.running).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports a changed file only to running servers whose project holds it and that serve it", async () => {
    const servers = create(fakeSpec());
    const a = await servers.clientFor(file("a/x.ts"));
    const b = await servers.clientFor(file("b/x.ts"));
    if (a.kind !== "ready" || b.kind !== "ready") throw new Error("not started");
    const reportA = vi.spyOn(a.client, "reportFileChanges");
    const reportB = vi.spyOn(b.client, "reportFileChanges");

    await servers.fileChanged(file("a/y.ts"), true);
    await servers.fileChanged(file("a/notes.md"), false);

    expect(reportA.mock.calls).toEqual([[[{ file: file("a/y.ts"), type: FileChangeType.Created }]]]);
    expect(reportB).not.toHaveBeenCalled();
  });

  it("tells a project's server what changed on disk since it started, once", async () => {
    await writeFile(file("a/edited.ts"), "");
    const servers = create(fakeSpec());
    const [lookup] = await servers.projectClients(file("a"));
    if (lookup?.kind !== "ready") throw new Error("not started");
    const report = vi.spyOn(lookup.client, "reportFileChanges");

    await writeFile(file("a/new.ts"), "");
    await rm(file("a/edited.ts"));
    await writeFile(file("a/told.ts"), "");
    await servers.fileChanged(file("a/told.ts"), true); // reported already: not again
    report.mockClear();

    await servers.projectClients(file("a"));
    await servers.projectClients(file("a"));
    expect(report.mock.calls).toEqual([
      [
        [
          { file: file("a/new.ts"), type: FileChangeType.Created },
          { file: file("a/edited.ts"), type: FileChangeType.Deleted },
        ],
      ],
    ]);
  });

  it("gives the project's servers: those whose root markers mark the folder", async () => {
    const servers = create(fakeSpec(), fakeSpec("ok", { id: "go", rootMarkers: ["go.mod"] }));
    expect(await servers.projectClients(file("a"))).toMatchObject([{ kind: "ready", root: file("a") }]);
    expect(await servers.projectClients(dir)).toEqual([]);
  });
});
