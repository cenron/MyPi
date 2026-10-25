import { createEventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { answer, ask, publish, subscribe } from "#core/events";

describe("publish and subscribe", () => {
  it("delivers each notice to every listener on the channel, until it stops", () => {
    const events = createEventBus();
    const first = vi.fn();
    const second = vi.fn();
    const stop = subscribe(events, "jobs", first);
    subscribe(events, "jobs", second);

    publish(events, "jobs", 2);
    stop();
    publish(events, "jobs", 0);

    expect(first.mock.calls).toEqual([[2]]);
    expect(second.mock.calls).toEqual([[2], [0]]);
  });

  // pi's bus is shared by every extension; another one's "jobs" isn't MyPi's.
  it("keeps MyPi's channels apart from other extensions'", () => {
    const events = createEventBus();
    const listener = vi.fn();
    subscribe(events, "jobs", listener);
    events.emit("jobs", 5);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("ask and answer", () => {
  // `ask` relies on this: every listener has run by the time `emit` returns. A pi that changes it fails here.
  it("relies on pi's bus calling every listener before emit returns", () => {
    const events = createEventBus();
    let called = false;
    events.on("x", () => {
      called = true;
    });
    events.emit("x", undefined);
    expect(called).toBe(true);
  });

  it("gathers every answer, sync or async, with the module it came from", async () => {
    const events = createEventBus();
    answer(events, "mode", "plan-build", () => "build");
    answer(events, "mode", "other", async () => "plan" as const);

    expect(await ask(events, "mode", undefined)).toEqual([
      { from: "plan-build", kind: "answer", value: "build" },
      { from: "other", kind: "answer", value: "plan" },
    ]);
  });

  it("passes the request to each answer", async () => {
    const events = createEventBus();
    const handler = vi.fn(() => []);
    answer(events, "diagnostics", "lsp", handler);
    await ask(events, "diagnostics", { files: ["/p/a.ts"] });
    expect(handler).toHaveBeenCalledWith({ files: ["/p/a.ts"] });
  });

  it("is empty when nobody answers", async () => {
    expect(await ask(createEventBus(), "mode", undefined)).toEqual([]);
  });

  it("returns a failed answer with its error, next to the others", async () => {
    const events = createEventBus();
    answer(events, "diagnostics", "lsp", () => {
      throw new Error("server crashed");
    });
    answer(events, "diagnostics", "lint", () => []);

    expect(await ask(events, "diagnostics", { files: [] })).toEqual([
      { from: "lsp", kind: "failed", error: "server crashed" },
      { from: "lint", kind: "answer", value: [] },
    ]);
  });
});
