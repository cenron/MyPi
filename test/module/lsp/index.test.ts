import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExtensionCommandContext, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LspModule } from "#module/lsp/index";
import { ServerManager } from "#module/lsp/manager";
import { SERVERS } from "#module/lsp/servers";
import { customEntry, fakeSession } from "../../fakes";

const SPACE = " ";
const ENTER = "\r";
const ESCAPE = "\x1b";
const DOWN = "\x1b[B";

/** A `tool_result` event, as pi sends it after a tool ran. */
function toolResult(toolName: string, path: string, isError = false) {
  return { type: "tool_result", toolCallId: "1", toolName, input: { path }, content: [], isError, details: undefined };
}

/** The module, after `init()`, over a fake session whose branch holds `branch`. */
function start(branch: unknown[] = []) {
  const fake = fakeSession(branch);
  const module = new LspModule(fake.session);
  module.init();
  return { ...fake, module };
}

type Factory = (tui: unknown, theme: Theme, keybindings: unknown, done: (result: unknown) => void) => Component;

/** A command context whose `ui.custom` builds the menu and presses `keys`. */
function pressing(keys: string[]) {
  const theme = { fg: (_c: string, text: string) => text, bg: (_c: string, text: string) => text } as Theme;
  const custom = (factory: Factory) =>
    new Promise((resolve) => {
      const component = factory({}, theme, {}, resolve);
      for (const key of keys) component.handleInput?.(key);
    });
  return { mode: "tui", ui: { custom } } as unknown as ExtensionCommandContext;
}

beforeAll(() => initTheme("dark"));
afterEach(() => vi.restoreAllMocks());

describe("LspModule", () => {
  it("offers the lsp tool, marked read-only so Plan mode allows it", () => {
    const [tool, ...rest] = start().module.tools();
    expect(rest).toEqual([]);
    expect(tool).toMatchObject({ name: "lsp", annotations: { readOnlyHint: true } });
  });

  it("reports each successful edit as changed and write as created", async () => {
    const fileChanged = vi.spyOn(ServerManager.prototype, "fileChanged").mockResolvedValue();
    const { emit } = start();

    await emit("tool_result", toolResult("edit", "src/a.ts"));
    await emit("tool_result", toolResult("write", "src/b.ts"));
    await emit("tool_result", toolResult("write", "src/c.ts", true));
    await emit("tool_result", toolResult("read", "src/d.ts"));

    expect(fileChanged.mock.calls).toEqual([
      ["/project/src/a.ts", false],
      ["/project/src/b.ts", true],
    ]);
  });

  it("stops every server when the session shuts down", async () => {
    const stopAll = vi.spyOn(ServerManager.prototype, "stopAll").mockResolvedValue();
    const { emit } = start();
    await emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
    expect(stopAll).toHaveBeenCalledOnce();
  });

  it("restores the saved off set", () => {
    const { module } = start([customEntry("mypi-module-lsp", { off: ["typescript", 3] })]);
    expect(module.servers.statuses().find((status) => status.spec.id === "typescript")?.on).toBe(false);
  });

  it("applies and saves the menu's choice on Save", async () => {
    // An installed TypeScript server, whatever this machine has; the menu locks a missing one.
    const bin = await mkdtemp(join(tmpdir(), "mypi-lsp-bin-"));
    await writeFile(join(bin, "tsc"), "");
    await chmod(join(bin, "tsc"), 0o755);
    vi.stubEnv("PATH", bin);

    try {
      const { module, appendEntry } = start();
      // TypeScript is the first row; Save comes after every server.
      const toSave = SERVERS.map(() => DOWN);
      const message = await module.commands()[0]?.execute(pressing([SPACE, ...toSave, ENTER]), []);

      expect(message).toBe("LSP servers off: TypeScript");
      expect(appendEntry).toHaveBeenCalledWith("mypi-module-lsp", { off: ["typescript"] });
      expect(module.servers.statuses()[0]?.on).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      await rm(bin, { recursive: true, force: true });
    }
  });

  it("changes nothing on Escape", async () => {
    const { module, appendEntry } = start();
    expect(await module.commands()[0]?.execute(pressing([ESCAPE]), [])).toBeUndefined();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("lists each server's state", async () => {
    const { module } = start();
    expect(await module.commands()[0]?.execute(pressing([]), ["list"])).toMatch(/^TypeScript: /);
  });
});
