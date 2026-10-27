import { describe, expect, it } from "vitest";
import {
  decode,
  describeFetchError,
  isImage,
  isTextual,
  mimeOf,
  readCapped,
  timeoutSignal,
} from "#tool/web-fetch/http";
import { trackedStream } from "./fakes";

const bytes = (size: number) => new Uint8Array(size).fill(97);

/** A body that never ends, so only the cap can stop the read. */
function endlessStream() {
  const state = { reads: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.reads++;
      controller.enqueue(bytes(1024));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("readCapped", () => {
  it("returns empty bytes for an empty body, or none at all", async () => {
    expect(await readCapped(new Response(""), 100)).toHaveLength(0);
    // A 204 or a HEAD response has a null body.
    expect(await readCapped(new Response(null, { status: 204 }), 100)).toHaveLength(0);
  });

  it("accepts a body of exactly maxBytes", async () => {
    const { stream } = trackedStream([bytes(60), bytes(40)]);
    expect(await readCapped(new Response(stream), 100)).toHaveLength(100);
  });

  it("fails on a body one byte over maxBytes and cancels the stream", async () => {
    const { stream, state } = trackedStream([bytes(60), bytes(41)]);
    await expect(readCapped(new Response(stream), 100)).rejects.toThrow();
    expect(state.cancelled).toBe(true);
  });

  it("rejects a Content-Length over maxBytes without reading the body, and cancels it", async () => {
    const { stream, state } = trackedStream([bytes(10)]);
    const response = new Response(stream, { headers: { "content-length": "101" } });
    await expect(readCapped(response, 100)).rejects.toThrow();
    // A ReadableStream pulls once on its own when created, so "not read" means no read past that first pull.
    expect(state.reads).toBeLessThanOrEqual(1);
    // An uncancelled body keeps the connection open until the response is garbage collected.
    expect(state.cancelled).toBe(true);
  });

  it("still caps a body larger than its Content-Length says", async () => {
    const { stream, state } = trackedStream([bytes(60), bytes(60)]);
    const response = new Response(stream, { headers: { "content-length": "50" } });
    await expect(readCapped(response, 100)).rejects.toThrow();
    expect(state.cancelled).toBe(true);
  });

  it("stops reading an endless body once it passes the cap", async () => {
    const { stream, state } = endlessStream();
    await expect(readCapped(new Response(stream), 10 * 1024)).rejects.toThrow();
    expect(state.cancelled).toBe(true);
    // 1 KB chunks against a 10 KB cap: the 11th chunk goes over. A few more pulls are queued ahead of the reader.
    expect(state.reads).toBeLessThan(20);
  });
});

describe("timeoutSignal", () => {
  it("is aborted right away when the parent already is", () => {
    const parent = new AbortController();
    parent.abort();
    const signal = timeoutSignal(parent.signal, 1000);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("AbortError");
  });
});

// Servers send "Text/HTML" too; every content-type check reads this.
describe("mimeOf", () => {
  it("drops parameters, trims, and lowercases", () => {
    expect(mimeOf(" Text/HTML ;charset=UTF-8")).toBe("text/html");
  });
});

describe("isTextual", () => {
  // One row per rule: text/*, the listed types, +json, +xml, and no type at all.
  it.each(["text/csv", "application/javascript", "application/ld+json", "image/svg+xml", ""])(
    "is true for %j",
    (mime) => {
      expect(isTextual(mime)).toBe(true);
    },
  );

  it("is false for a binary type", () => {
    expect(isTextual("application/pdf")).toBe(false);
  });
});

describe("isImage", () => {
  it("is true for an image, but not for SVG, which is XML a model can read", () => {
    expect(isImage("image/png")).toBe(true);
    expect(isImage("image/svg+xml")).toBe(false);
    expect(isImage("text/html")).toBe(false);
  });
});

describe("decode", () => {
  const latin1E = new Uint8Array([0xe9]); // "é" in ISO-8859-1; not valid UTF-8 on its own

  it("accepts a quoted charset", () => {
    expect(decode(latin1E, 'text/html; charset="iso-8859-1"')).toBe("é");
  });

  it("falls back to UTF-8 for a charset it doesn't know", () => {
    expect(decode(new TextEncoder().encode("héllo"), "text/plain; charset=bogus")).toBe("héllo");
  });
});

describe("describeFetchError", () => {
  it("adds the network code from the cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), { code: "ENOTFOUND" });
    expect(describeFetchError(new TypeError("fetch failed", { cause }), 30)).toBe("fetch failed (ENOTFOUND)");
  });
});
