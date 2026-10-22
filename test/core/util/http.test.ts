import { describe, expect, it } from "vitest";
import {
  decode,
  describeFetchError,
  failWith,
  isImage,
  isTextual,
  mimeOf,
  readCapped,
  timeoutSignal,
} from "#core/util/http";

const bytes = (size: number) => new Uint8Array(size).fill(97);

/** A body that hands out `chunks` one per read, and records whether it was read or cancelled. */
function trackedStream(chunks: Uint8Array[]) {
  const state = { reads: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[state.reads++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

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

/** Resolves once `signal` aborts, or after `ms` with `false`. */
const abortedWithin = (signal: AbortSignal, ms: number) =>
  new Promise<boolean>((resolve) => {
    if (signal.aborted) return resolve(true);
    const timer = setTimeout(() => resolve(false), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

describe("readCapped", () => {
  it("returns the body's bytes, joining chunks in order", async () => {
    const encoder = new TextEncoder();
    const { stream } = trackedStream([encoder.encode("one "), encoder.encode("two "), encoder.encode("three")]);
    const body = await readCapped(new Response(stream), 100);
    expect(new TextDecoder().decode(body)).toBe("one two three");
  });

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

  it("ignores a Content-Length that isn't a number", async () => {
    const response = new Response("hello", { headers: { "content-length": "lots" } });
    expect(await readCapped(response, 100)).toHaveLength(5);
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
  it("aborts with a TimeoutError once the time is up", async () => {
    const signal = timeoutSignal(undefined, 20);
    expect(await abortedWithin(signal, 1000)).toBe(true);
    expect(signal.reason).toBeInstanceOf(DOMException);
    expect((signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("doesn't abort before the time is up", async () => {
    const signal = timeoutSignal(new AbortController().signal, 1000);
    expect(await abortedWithin(signal, 50)).toBe(false);
  });

  it("aborts when the parent aborts, with the parent's reason", async () => {
    const parent = new AbortController();
    const signal = timeoutSignal(parent.signal, 1000);
    parent.abort(new Error("user cancelled"));
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toEqual(new Error("user cancelled"));
  });

  it("is aborted right away when the parent already is", () => {
    const parent = new AbortController();
    parent.abort();
    const signal = timeoutSignal(parent.signal, 1000);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe("AbortError");
  });
});

describe("mimeOf", () => {
  it("drops parameters, trims, and lowercases", () => {
    expect(mimeOf(" Text/HTML ;charset=UTF-8")).toBe("text/html");
    expect(mimeOf("")).toBe("");
  });
});

describe("isTextual", () => {
  // One row per rule: text/*, the listed types, +json, +xml, and no type at all.
  it.each([
    "text/plain",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/ld+json",
    "image/svg+xml",
    "",
  ])("is true for %j", (mime) => {
    expect(isTextual(mime)).toBe(true);
  });

  it.each(["image/png", "application/pdf"])("is false for %j", (mime) => {
    expect(isTextual(mime)).toBe(false);
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

  it("decodes UTF-8 when there's no charset", () => {
    expect(decode(new TextEncoder().encode("héllo"), "text/plain")).toBe("héllo");
  });

  it("honors the charset in the content type", () => {
    expect(decode(latin1E, "text/html; charset=ISO-8859-1")).toBe("é");
  });

  it("accepts a quoted charset", () => {
    expect(decode(latin1E, 'text/html; charset="iso-8859-1"')).toBe("é");
  });

  it("falls back to UTF-8 for a charset it doesn't know", () => {
    expect(decode(new TextEncoder().encode("héllo"), "text/plain; charset=bogus")).toBe("héllo");
  });

  it("re-throws errors other than an unknown charset", () => {
    // Not bytes at all: TextDecoder throws a TypeError, which isn't the fallback's to hide.
    expect(() => decode("text" as unknown as Uint8Array, "text/plain")).toThrow(TypeError);
  });
});

describe("failWith", () => {
  it("cancels the body, then throws the message", async () => {
    const { stream, state } = trackedStream([bytes(10)]);
    await expect(failWith(new Response(stream), "HTTP 404 Not Found")).rejects.toThrow("HTTP 404 Not Found");
    expect(state.cancelled).toBe(true);
  });

  it("throws for a response with no body", async () => {
    await expect(failWith(new Response(null, { status: 204 }), "nothing")).rejects.toThrow("nothing");
  });
});

describe("describeFetchError", () => {
  it("names a timeout with its seconds", () => {
    expect(describeFetchError(new DOMException("aborted", "TimeoutError"), 30)).toBe("timed out after 30s");
  });

  it("adds the network code from the cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), { code: "ENOTFOUND" });
    expect(describeFetchError(new TypeError("fetch failed", { cause }), 30)).toBe("fetch failed (ENOTFOUND)");
  });

  it("uses the message alone when the cause has no code", () => {
    expect(describeFetchError(new Error("HTTP 500", { cause: new Error("inner") }), 30)).toBe("HTTP 500");
  });

  it("stringifies a thrown non-Error", () => {
    expect(describeFetchError("boom", 30)).toBe("boom");
  });
});
