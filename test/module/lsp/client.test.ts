import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
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
