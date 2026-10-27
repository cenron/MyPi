import { type ExtensionContext, initTheme } from "@earendil-works/pi-coding-agent";
import { beforeAll, describe, expect, it } from "vitest";
import type { ServerStatus } from "#module/lsp/manager";
import { openLspMenu, statusLine } from "#module/lsp/menu";
import { customPressing, KEY } from "../../fakes";
import { fakeSpec } from "./fakes";

const { SPACE, ENTER, DOWN } = KEY;

/** A status for server `id`: installed, on, and idle unless `changes` says otherwise. */
function status(id: string, changes: Partial<ServerStatus> = {}): ServerStatus {
  return {
    spec: fakeSpec("ok", { id, language: id.toUpperCase() }),
    path: "/bin/server",
    on: true,
    running: [],
    starting: [],
    failed: [],
    ...changes,
  };
}

function fakeContext(keys: string[], mode = "tui") {
  const custom = customPressing(keys);
  return { ctx: { mode, ui: { custom } } as unknown as ExtensionContext, custom };
}

/** Opens the menu, presses the keys, and returns the off ids, or `undefined` on Escape. */
async function press(keys: string[], statuses: ServerStatus[]) {
  const off = await openLspMenu(fakeContext(keys).ctx, statuses);
  return off && [...off];
}

// getSettingsListTheme() reads pi's global theme, which tests have to set up.
beforeAll(() => initTheme("dark"));

describe("openLspMenu", () => {
  it("refuses to open outside TUI mode", async () => {
    const { ctx, custom } = fakeContext([], "print");
    await expect(openLspMenu(ctx, [status("a")])).rejects.toThrow("/lsp requires TUI mode");
    expect(custom).not.toHaveBeenCalled();
  });

  it("returns the servers turned off on Save", async () => {
    const statuses = [status("a"), status("b", { on: false })];
    expect(await press([SPACE, DOWN, SPACE, DOWN, ENTER], statuses)).toEqual(["a"]);
  });

  it("locks a server that isn't installed, keeping its setting", async () => {
    const statuses = [status("a", { path: undefined }), status("b", { path: undefined, on: false })];
    expect(await press([SPACE, DOWN, SPACE, DOWN, ENTER], statuses)).toEqual(["b"]);
  });
});

describe("statusLine", () => {
  it.each([
    ["not installed", { path: undefined, on: false }],
    ["off", { on: false, running: ["/p"] }],
    ["running", { running: ["/p"], failed: [{ root: "/q", error: "x" }] }],
    ["starting", { starting: ["/p"] }],
    ["failed", { failed: [{ root: "/p", error: "x" }] }],
    ["installed", {}],
  ])("says %s", (state, changes: Partial<ServerStatus>) => {
    expect(statusLine(status("ts", changes))).toBe(`TS: ${state}`);
  });
});
