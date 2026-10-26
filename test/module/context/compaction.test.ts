import type { SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { compact } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { steerCompaction } from "#module/context/compaction";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
  compact: vi.fn(),
}));

const preparation = {} as SessionBeforeCompactEvent["preparation"];

function setup() {
  const warn = vi.fn();
  const getApiKeyAndHeaders = vi.fn().mockResolvedValue({
    ok: true,
    apiKey: "key",
    headers: { authorization: "token", removed: null },
    env: { A: "b" },
  });
  const ctx = { model: { provider: "openai", id: "model" }, modelRegistry: { getApiKeyAndHeaders } } as never;
  return { ctx, warn, getApiKeyAndHeaders };
}

describe("steerCompaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("combines the user's focus with MyPi's instructions and returns pi's summary", async () => {
    const result = { summary: "summary" } as Awaited<ReturnType<typeof compact>>;
    vi.mocked(compact).mockResolvedValue(result);
    const { ctx, warn, getApiKeyAndHeaders } = setup();
    const event = {
      preparation,
      customInstructions: "Focus on the API decision",
      signal: new AbortController().signal,
    } as SessionBeforeCompactEvent;

    await expect(steerCompaction(event, ctx, warn)).resolves.toEqual({ compaction: result });
    expect(getApiKeyAndHeaders).toHaveBeenCalledOnce();
    expect(compact).toHaveBeenCalledWith(
      preparation,
      expect.objectContaining({ id: "model" }),
      "key",
      { authorization: "token" },
      expect.stringMatching(/^Focus on the API decision\n\nKeep every decision the user made/),
      event.signal,
      undefined,
      undefined,
      { A: "b" },
    );
  });

  it("warns and lets pi summarize when steering fails", async () => {
    vi.mocked(compact).mockRejectedValue(new Error("unavailable"));
    const { ctx, warn } = setup();

    await expect(
      steerCompaction({ preparation, signal: new AbortController().signal } as SessionBeforeCompactEvent, ctx, warn),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("couldn't steer this compaction: unavailable"),
    );
  });
});
