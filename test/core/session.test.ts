import { rm } from "node:fs/promises";
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { Session } from "#core/session";
import { customEntry, fakeSession } from "../fakes";

function fakeContext(hasUI: boolean) {
  const notify = vi.fn();
  const ctx = { hasUI, ui: { notify } } as unknown as ExtensionContext;
  return { ctx, notify };
}

function fakePi() {
  const handlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
  return {
    api: {
      events: createEventBus(),
      on: (event: string, handler: (event: unknown, context: ExtensionContext) => unknown) => {
        handlers.set(event, handler);
        return () => {};
      },
    } as unknown as ExtensionAPI,
    emit: (event: string) => handlers.get(event)?.({}, {} as ExtensionContext),
  };
}

describe("Session", () => {
  it("sends each log level as the matching notify type", () => {
    const { ctx, notify } = fakeContext(true);
    const session = new Session(ctx, fakePi().api, undefined);

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
    const session = new Session(ctx, fakePi().api, undefined);

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

  it("draws the jobs widget while jobs run, updates it each second, and clears it when they end", async () => {
    const { session, setStatus } = fakeSession();
    const clear = vi.spyOn(globalThis, "clearInterval");
    let finish!: (code: number) => void;
    const first = session.jobs.start({
      kind: "test",
      label: "a",
      run: () => new Promise((resolve) => (finish = resolve)),
    });
    const second = session.jobs.start({ kind: "test", label: "b", run: async () => 0 });
    await second.done;
    finish(0);
    await first.done;
    expect(setStatus).not.toHaveBeenCalled();
    expect(session.ctx.ui.setWidget).toHaveBeenCalledWith(
      "mypi-jobs",
      expect.arrayContaining([expect.stringContaining("2 running")]),
      {
        placement: "belowEditor",
      },
    );
    expect(session.ctx.ui.setWidget).toHaveBeenLastCalledWith("mypi-jobs", undefined, { placement: "belowEditor" });
    expect(clear).toHaveBeenCalledOnce();
    await Promise.all([first, second].map((job) => rm(job.info.logPath, { force: true })));
  });

  it("does not draw a jobs widget without a UI", async () => {
    const setWidget = vi.fn();
    const ctx = { cwd: "/project", hasUI: false, ui: { setWidget } } as unknown as ExtensionContext;
    const session = new Session(ctx, fakePi().api, undefined);
    const job = session.jobs.start({ kind: "test", label: "short", run: async () => 0 });
    await job.done;
    expect(setWidget).not.toHaveBeenCalled();
    await rm(job.info.logPath, { force: true });
  });

  it("clears the jobs interval on session shutdown", async () => {
    vi.useFakeTimers();
    const fake = fakePi();
    const setWidget = vi.fn();
    const theme = { fg: (_color: string, text: string) => text };
    const ctx = { cwd: "/project", hasUI: true, ui: { setWidget, theme } } as unknown as ExtensionContext;
    const session = new Session(ctx, fake.api, undefined);
    let stop!: () => void;
    const job = session.jobs.start({
      kind: "test",
      label: "running",
      run: (signal) =>
        new Promise<number>((_resolve, reject) => {
          stop = () => reject(new Error("stopped"));
          signal.addEventListener("abort", stop);
        }),
    });
    const clear = vi.spyOn(globalThis, "clearInterval");

    await vi.advanceTimersByTimeAsync(1000);
    fake.emit("session_shutdown");
    expect(setWidget).toHaveBeenLastCalledWith("mypi-jobs", undefined, { placement: "belowEditor" });
    expect(clear).toHaveBeenCalledOnce();

    session.jobs.stopAll();
    stop();
    await job.done;
    await rm(job.info.logPath, { force: true });
    vi.useRealTimers();
  });
});
