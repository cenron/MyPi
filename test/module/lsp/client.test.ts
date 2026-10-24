import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileChangeType } from "vscode-languageserver-protocol/node";
import { LspClient } from "#module/lsp/client";
import { FAKE_SERVER } from "./fakes";

const start = (mode: string) => LspClient.start(process.execPath, [FAKE_SERVER, mode], tmpdir());

describe("LspClient", () => {
  it("starts a server, then shuts it down", async () => {
    const client = await start("ok");
    expect(client.isRunning).toBe(true);

    await client.stop();
    expect(client.isRunning).toBe(false);
    await client.stop(); // twice is fine
  });

  it("fails with the server's stderr when it exits while starting", async () => {
    await expect(start("crash")).rejects.toThrow(/exited while starting \(code 3\)\nboom: bad config/);
  });

  it("fails when the command can't be spawned", async () => {
    await expect(LspClient.start("/nonexistent/server", [], tmpdir())).rejects.toThrow("couldn't start");
  });

  it("kills a server that doesn't answer shutdown", async () => {
    const client = await start("stubborn");
    await client.stop();
    await client.exited;
    expect(client.isRunning).toBe(false);
  });
});

describe("LspClient talking to a server", () => {
  let dir: string;
  let client: LspClient;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mypi-lsp-"));
    client = await LspClient.start(process.execPath, [FAKE_SERVER, "ok"], dir);
  });
  afterEach(async () => {
    await client.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const names = (symbols: { name: string }[]) => symbols.map((symbol) => symbol.name);

  it("answers the server's settings requests with empty settings", async () => {
    await vi.waitFor(async () => expect(names(await client.workspaceSymbols("__config__"))).toEqual(["[{}]"]));
  });

  it("opens a file once, and sends it again only when it changed", async () => {
    const file = join(dir, "a.ts");
    await writeFile(file, "class A\n");
    const notify = vi.spyOn(client.connection, "sendNotification");

    const { uri } = await client.sync(file, "typescript");
    await client.sync(file, "typescript");
    expect(notify).toHaveBeenCalledOnce();
    expect(client.hasOpenDocuments).toBe(true);

    await writeFile(file, "class B\n");
    expect(await client.sync(file, "typescript")).toEqual({ uri, text: "class B\n" });
    expect(names(await client.documentSymbols(uri))).toEqual(["B"]);

    await writeFile(file, "class C\n");
    await client.syncOpen();
    expect(names(await client.documentSymbols(uri))).toEqual(["C"]);
  });

  it("closes an open file that's gone from disk", async () => {
    const file = join(dir, "a.ts");
    await writeFile(file, "class A\n");
    await client.sync(file, "typescript");

    await rm(file);
    await client.syncOpen();
    expect(client.hasOpenDocuments).toBe(false);
  });

  it("reports files changed or created on disk", async () => {
    await client.reportFileChanges([
      { file: join(dir, "a.ts"), type: FileChangeType.Changed },
      { file: join(dir, "b.ts"), type: FileChangeType.Created },
    ]);
    const [reported] = await client.workspaceSymbols("__changes__");
    expect(JSON.parse(reported?.name ?? "")).toEqual([
      { uri: pathToFileURL(join(dir, "a.ts")).href, type: FileChangeType.Changed },
      { uri: pathToFileURL(join(dir, "b.ts")).href, type: FileChangeType.Created },
    ]);
  });
});
