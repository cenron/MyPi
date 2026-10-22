import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { webFetchTool } from "#tool/web-fetch";
import { fakeSession } from "../fakes";

const PAGE = "https://example.com/page";

type Reply = {
  body?: ConstructorParameters<typeof Response>[0];
  status?: number;
  headers?: Record<string, string>;
  url?: string;
};

/** A Response as `fetch` would return it; `url` is where it was fetched from, so redirects can be faked. */
function response({ body = "hello", status = 200, headers = { "content-type": "text/plain" }, url = PAGE }: Reply) {
  const res = new Response(body, { status, headers });
  // A constructed Response has an empty `url`; a fetched one has the final URL after redirects.
  Object.defineProperty(res, "url", { value: url });
  return res;
}

/** A body that records whether it was cancelled. */
function trackedBody(text = "body") {
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

/** A `fetch` that never answers and rejects with the signal's reason once aborted, like the real one. */
const hangingFetch = (_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => response({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers each fetch call with the next reply in order. */
const replyWith = (...replies: Reply[]) => {
  for (const reply of replies) fetchMock.mockResolvedValueOnce(response(reply));
};

const run = (params: { url: string; timeout?: number }, signal?: AbortSignal) =>
  webFetchTool(fakeSession().session).definition.execute("call-1", params, signal, undefined, {} as never);

const textOf = async (params: { url: string; timeout?: number }) => {
  const result = await run(params);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
};

/** The headers sent on fetch call `call`. */
const sentHeaders = (call = 0) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);

describe("web_fetch", () => {
  describe("the URL", () => {
    it("rejects an invalid URL", async () => {
      await expect(run({ url: "not a url" })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(["file:///etc/passwd", "ftp://example.com/file", "data:text/plain,hi"])(
      "rejects %s without fetching",
      async (url) => {
        await expect(run({ url })).rejects.toThrow(/http/);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each(["http://example.com/", "https://example.com/"])("fetches %s", async (url) => {
      replyWith({ url });
      await run({ url });
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe("the request", () => {
    it("sends a MyPi user agent, a markdown-first Accept, and Accept-Language", async () => {
      await run({ url: PAGE });
      const headers = sentHeaders();
      expect(headers.get("user-agent")).toContain("MyPi/");
      expect(headers.get("accept")).toMatch(/^text\/markdown/);
      expect(headers.get("accept-language")).toBe("en-US,en;q=0.9");
    });

    it("passes an abort signal", async () => {
      await run({ url: PAGE });
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("Cloudflare", () => {
    const challenge: Reply = { status: 403, headers: { "cf-mitigated": "challenge" } };

    it("retries a challenge once with the mypi user agent", async () => {
      replyWith(challenge, { body: "through" });
      expect(await textOf({ url: PAGE })).toContain("through");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(sentHeaders(1).get("user-agent")).toBe("mypi");
    });

    it("gives up after one retry", async () => {
      replyWith(challenge, challenge);
      await expect(run({ url: PAGE })).rejects.toThrow(/403/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("doesn't retry a plain 403", async () => {
      replyWith({ status: 403 });
      await expect(run({ url: PAGE })).rejects.toThrow(/403/);
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe("the status", () => {
    it("fails on a non-2xx status and cancels its body", async () => {
      const { stream, state } = trackedBody("not here");
      fetchMock.mockResolvedValueOnce(response({ body: stream, status: 404 }));
      await expect(run({ url: PAGE })).rejects.toThrow(/HTTP 404/);
      expect(state.cancelled).toBe(true);
    });
  });

  describe("the content type", () => {
    it("rejects an image", async () => {
      replyWith({ body: new Uint8Array([0x89]), headers: { "content-type": "image/png" } });
      await expect(run({ url: PAGE })).rejects.toThrow(/image/i);
    });

    it("rejects a binary file such as a PDF", async () => {
      replyWith({ body: new Uint8Array([0x25]), headers: { "content-type": "application/pdf" } });
      await expect(run({ url: PAGE })).rejects.toThrow(/content type/i);
    });

    it("reads JSON", async () => {
      replyWith({ body: '{"ok":true}', headers: { "content-type": "application/json; charset=utf-8" } });
      expect(await textOf({ url: PAGE })).toContain('{"ok":true}');
    });

    it("reads a response with no content type", async () => {
      // A string body would get text/plain on its own; bytes get no content type.
      replyWith({ body: new TextEncoder().encode("untyped"), headers: {} });
      expect(await textOf({ url: PAGE })).toContain("untyped");
    });

    it("decodes with the response's charset", async () => {
      replyWith({
        body: new Uint8Array([0x63, 0x61, 0x66, 0xe9]),
        headers: { "content-type": "text/plain; charset=latin1" },
      });
      expect(await textOf({ url: PAGE })).toContain("café");
    });
  });

  describe("the size cap", () => {
    it("fails on a body over 5 MB", async () => {
      replyWith({ body: new Uint8Array(5 * 1024 * 1024 + 1) });
      await expect(run({ url: PAGE })).rejects.toThrow(/Response is over 5\.0MB/);
    });
  });

  describe("errors", () => {
    it("prefixes failures with the URL", async () => {
      replyWith({ status: 500 });
      await expect(run({ url: PAGE })).rejects.toThrow(`Unable to fetch ${PAGE}`);
    });

    it("reports a network error with its code", async () => {
      const cause = Object.assign(new Error("getaddrinfo ENOTFOUND example.com"), { code: "ENOTFOUND" });
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause }));
      await expect(run({ url: PAGE })).rejects.toThrow(/fetch failed \(ENOTFOUND\)/);
    });

    it("times out after the given number of seconds", async () => {
      fetchMock.mockImplementationOnce(hangingFetch);
      await expect(run({ url: PAGE, timeout: 1 })).rejects.toThrow(/timed out after 1s/);
    });

    it("re-throws a user cancel as is", async () => {
      const controller = new AbortController();
      const reason = new Error("cancelled by the user");
      fetchMock.mockImplementationOnce(hangingFetch);
      const pending = run({ url: PAGE }, controller.signal);
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  });

  describe("the result", () => {
    it("starts with the URL and content type, then the text", async () => {
      replyWith({ body: "hello", headers: { "content-type": "text/plain; charset=utf-8" } });
      expect(await textOf({ url: PAGE })).toBe(`URL: ${PAGE}\nContent-Type: text/plain; charset=utf-8\n\nhello`);
    });

    it("shows the final URL after a redirect", async () => {
      replyWith({ url: "https://example.com/moved" });
      expect(await textOf({ url: PAGE })).toMatch(/^URL: https:\/\/example\.com\/moved\n/);
    });

    it("returns details about the fetch", async () => {
      replyWith({ body: "hello", url: "https://example.com/moved" });
      const { details } = await run({ url: PAGE });
      expect(details).toEqual({
        url: PAGE,
        finalUrl: "https://example.com/moved",
        status: 200,
        contentType: "text/plain",
        bytes: 5,
        truncated: false,
      });
    });

    it("truncates past 2000 lines and says so", async () => {
      const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
      replyWith({ body: lines });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      const text = first?.type === "text" ? first.text : "";
      expect(text).toMatch(/\[Truncated/);
      expect(text).not.toContain("line 2499");
      expect(result.details).toMatchObject({ truncated: true });
    });

    it("leaves a short page whole", async () => {
      replyWith({ body: "one\ntwo\nthree" });
      expect(await textOf({ url: PAGE })).not.toMatch(/\[Truncated/);
    });

    // Minified HTML is often one line; cutting only at line ends would leave nothing.
    it("keeps the first 50KB of a page that is one long line", async () => {
      replyWith({ body: "x".repeat(200 * 1024), headers: { "content-type": "text/html" } });
      const text = await textOf({ url: PAGE });
      expect(text).toContain("x".repeat(50 * 1024));
      expect(text).not.toContain("x".repeat(50 * 1024 + 1));
      expect(text).toMatch(/\[Truncated: showed the first 50\.0KB of 200\.0KB\]/);
    });
  });

  describe("the definition", () => {
    const { definition } = webFetchTool(fakeSession().session);

    it("is read-only and open-world, so plan-build allows it without asking", () => {
      expect(definition.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    });

    it("tells the model page text is data, and shows up in Available tools", () => {
      expect(definition.description).toMatch(/not instructions/);
      expect(definition.promptSnippet).toBeTruthy();
    });
  });
});
