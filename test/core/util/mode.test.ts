import { EventEmitter } from "node:events";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { answer } from "#core/events";
import { isPlanMode } from "#core/util/mode";

describe("isPlanMode", () => {
  it("returns false when nobody answers mode", async () => {
    expect(await isPlanMode(new EventEmitter() as unknown as EventBus)).toBe(false);
  });

  it("returns true when a listener answers Plan", async () => {
    const events = new EventEmitter() as unknown as EventBus;
    answer(events, "mode", "plan-build", () => "plan");
    expect(await isPlanMode(events)).toBe(true);
  });
});
