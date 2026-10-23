import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { customEntry, fakeSession } from "../fakes";

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

  it("loads the last mypi-<name> entry on the branch", () => {
    const { session } = fakeSession([
      customEntry("mypi-modules", { loaded: ["a"] }),
      customEntry("mypi-modules", { loaded: ["b"] }),
    ]);
    expect(session.load("modules")).toEqual({ loaded: ["b"] });
  });

  // Other extensions write custom entries to the same session file.
  it("ignores other entries, including another extension's and unprefixed ones", () => {
    const { session } = fakeSession([
      customEntry("mypi-modules", { loaded: ["a"] }),
      { type: "message", customType: "mypi-modules", data: { loaded: ["x"] } },
      customEntry("modules", { loaded: ["y"] }),
      customEntry("other-ext", { loaded: ["z"] }),
    ]);
    expect(session.load("modules")).toEqual({ loaded: ["a"] });
  });
});
