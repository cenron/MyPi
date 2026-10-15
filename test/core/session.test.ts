import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { type ModuleInfo, ModuleLoadMode } from "#core/types";

function moduleInfo(name: string): ModuleInfo {
  return {
    name,
    description: "",
    commands: [],
    loadType: ModuleLoadMode.ON_LOAD,
  };
}

function fakeContext(hasUI: boolean) {
  const notify = vi.fn();
  const ctx = { hasUI, ui: { notify } } as unknown as ExtensionContext;
  return { ctx, notify };
}

const pi = {} as ExtensionAPI;

describe("Session", () => {
  it("sends each log level as the matching notify type", () => {
    const { ctx, notify } = fakeContext(true);
    const session = new Session(ctx, pi);

    session.log("hello");
    session.logWarning("careful");
    session.logError("broken");

    expect(notify.mock.calls).toEqual([
      ["hello", "info"],
      ["careful", "warning"],
      ["broken", "error"],
    ]);
  });

  it("sends nothing without a UI", () => {
    const { ctx, notify } = fakeContext(false);
    const session = new Session(ctx, pi);

    session.log("hello");
    session.logWarning("careful");
    session.logError("broken");

    expect(notify).not.toHaveBeenCalled();
  });

  it("replaces the module list when set again", () => {
    const session = new Session(fakeContext(true).ctx, pi);

    session.modules = [moduleInfo("a")];
    session.modules = [moduleInfo("b")];

    expect(session.modules.map((m) => m.name)).toEqual(["b"]);
  });
});
