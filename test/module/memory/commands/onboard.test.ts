import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { onboardCmd } from "#module/memory/commands/onboard";
import { ONBOARD_PROMPT } from "#module/memory/prompt";

describe("onboardCmd", () => {
  // Pi refuses a new prompt mid-run, so the send must come after the wait.
  it("waits for the current run, then sends the onboarding prompt", async () => {
    const calls: string[] = [];
    // Idle comes a tick later, like a run finishing, so a send that doesn't wait lands first.
    const waitForIdle = vi.fn(async () => {
      await Promise.resolve();
      calls.push("idle");
    });
    const ctx = { waitForIdle } as unknown as ExtensionCommandContext;

    const result = await onboardCmd((text) => calls.push(text)).execute(ctx, []);

    expect(calls).toEqual(["idle", ONBOARD_PROMPT]);
    expect(result).toContain("/new");
  });
});
