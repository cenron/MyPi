import { readFile, rm } from "node:fs/promises";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { publicLookup } from "#tool/web-fetch/address";
import { webFetchTool } from "#tool/web-fetch/index";
import { trackedStream } from "./fakes";

const PAGE = "https://example.com/page";

/** `htmlToMarkdown` throws this once when set, to test the fallback to raw HTML. */
const convertFailure = vi.hoisted(() => ({ next: undefined as Error | undefined }));

vi.mock("#tool/web-fetch/markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#tool/web-fetch/markdown")>();
  return {
    ...actual,
    htmlToMarkdown: (html: string, baseUrl: string) => {
      const error = convertFailure.next;
      convertFailure.next = undefined;
      if (error) throw error;
      return actual.htmlToMarkdown(html, baseUrl);
    },
  };
});

/**
 * The network, faked: undici's `fetch` calls `net.fetch`, each `Agent` built is recorded, and DNS answers come from
 * `net.dns` (any name not listed resolves to a public address; an Error there is thrown).
 */
const net = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  agents: [] as { options: unknown; closed: number }[],
  dns: new Map<string, string[] | Error>(),
}));

vi.mock("undici", () => ({
  Agent: class {
    record: { options: unknown; closed: number };
    constructor(options: unknown) {
      this.record = { options, closed: 0 };
      net.agents.push(this.record);
    }
    // Like undici, closing a second time rejects.
    async close() {
      this.record.closed++;
      if (this.record.closed > 1) throw new Error("The client is destroyed");
    }
  },
  fetch: (...args: Parameters<typeof fetch>) => net.fetch(...args),
}));

vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    const answer = net.dns.get(host) ?? ["93.184.215.14"];
    if (answer instanceof Error) throw answer;
    return answer.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  },
}));

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

/** A `fetch` that never answers and rejects with the signal's reason once aborted, or at once if it already is, like
 * the real one. */
const hangingFetch = (_input: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) return reject(init.signal.reason);
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = net.fetch;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => response({}));
  net.agents.length = 0;
  net.dns.clear();
});

/** Answers each fetch call with the next reply in order. */
const replyWith = (...replies: Reply[]) => {
  for (const reply of replies) fetchMock.mockResolvedValueOnce(response(reply));
};

type Params = { url: string; format?: "markdown" | "html"; timeout?: number };

const run = (params: Params, signal?: AbortSignal) =>
  webFetchTool().definition.execute("call-1", params, signal, undefined, {} as never);

const textOf = async (params: Params) => {
  const result = await run(params);
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
};

/** The headers sent on fetch call `call`. */
const sentHeaders = (call = 0) => new Headers(fetchMock.mock.calls[call]?.[1]?.headers);

describe("web_fetch", () => {
  describe("the URL", () => {
    it("rejects a scheme other than http(s) without fetching", async () => {
      await expect(run({ url: "file:///etc/passwd" })).rejects.toThrow(/Only http: and https:/);
      expect(fetchMock).not.toHaveBeenCalled();
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
      const { stream, state } = trackedStream([new TextEncoder().encode("not here")]);
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

    it("returns details about the fetch", async () => {
      replyWith({ status: 301, headers: { location: "https://example.com/moved" } }, { body: "hello" });
      const { details } = await run({ url: PAGE });
      expect(details).toEqual({
        url: PAGE,
        finalUrl: "https://example.com/moved",
        status: 200,
        contentType: "text/plain",
        bytes: 5,
        truncated: false,
        format: "markdown",
        converted: false,
      });
    });

    it("truncates past 2000 lines, saves the whole text, and says where", async () => {
      const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join("\n");
      replyWith({ body: lines });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      const text = first?.type === "text" ? first.text : "";
      const { fullTextPath } = result.details as { fullTextPath: string };
      try {
        expect(text).not.toContain("line 2499");
        expect(fullTextPath).toMatch(/pi-web-fetch-[0-9a-f]{16}\.txt$/);
        expect(text).toContain(`[Truncated: showed 2000 of 2500 lines. The full text is in ${fullTextPath}`);
        expect(await readFile(fullTextPath, "utf8")).toBe(lines);
        expect(result.details).toMatchObject({ truncated: true });
      } finally {
        await rm(fullTextPath, { force: true });
      }
    });

    it("saves a converted page's full text as markdown", async () => {
      const paragraphs = Array.from({ length: 1500 }, (_, i) => `<p>paragraph ${i}</p>`).join("");
      replyWith({ body: `<html><body>${paragraphs}</body></html>`, headers: { "content-type": "text/html" } });
      const { details } = await run({ url: PAGE });
      const { fullTextPath } = details as { fullTextPath: string };
      try {
        expect(fullTextPath).toMatch(/\.md$/);
        expect(await readFile(fullTextPath, "utf8")).toContain("paragraph 1499");
      } finally {
        await rm(fullTextPath, { force: true });
      }
    });
  });

  describe("HTML", () => {
    const HTML = "text/html; charset=utf-8";
    const DOC =
      "<html><head><title>Docs</title></head><body><nav>menu</nav>" +
      '<main><h1>Hello</h1><p>A <a href="/next">link</a>.</p></main></body></html>';

    it("converts an HTML page to markdown, with a Title line", async () => {
      replyWith({ body: DOC, headers: { "content-type": HTML } });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      expect(first?.type === "text" && first.text).toBe(
        `URL: ${PAGE}\nTitle: Docs\nContent-Type: ${HTML}\n\n# Hello\n\nA [link](https://example.com/next).`,
      );
      expect(result.details).toMatchObject({ format: "markdown", converted: true, title: "Docs" });
    });

    it("resolves links against the final URL after a redirect", async () => {
      replyWith(
        { status: 302, headers: { location: "https://other.example.org/a/page" } },
        { body: DOC, headers: { "content-type": HTML } },
      );
      expect(await textOf({ url: PAGE })).toContain("[link](https://other.example.org/next)");
    });

    it.each([
      ["application/xhtml+xml", DOC, true],
      ["text/plain", "<p>not html</p>", false],
    ])("converts %s: %s", async (type, body, converted) => {
      replyWith({ body, headers: { "content-type": type } });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      const text = first?.type === "text" ? first.text : "";
      expect(text.includes(body)).toBe(!converted);
      expect(result.details).toMatchObject({ converted });
    });

    it("converts before truncating, so a big page with little text isn't cut", async () => {
      const chrome = '<a href="/x">menu item</a>'.repeat(15_000); // about 400 KB of navigation
      replyWith({
        body: `<html><body><nav>${chrome}</nav><main><p>short</p></main></body></html>`,
        headers: { "content-type": HTML },
      });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      const text = first?.type === "text" ? first.text : "";
      expect(text).toContain("short");
      expect(text).not.toMatch(/\[Truncated/);
      expect(result.details).toMatchObject({ truncated: false, converted: true });
      // `bytes` is what was downloaded, before conversion.
      expect((result.details as { bytes: number }).bytes).toBeGreaterThan(50 * 1024);
    });

    it("says when a page has no text without JavaScript", async () => {
      const app =
        '<html><head><title>App</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>';
      replyWith({ body: app, headers: { "content-type": HTML } });
      const text = await textOf({ url: PAGE });
      expect(text).toContain("Title: App");
      expect(text).toMatch(/needs JavaScript/);
      expect(text).toContain('format: "html"');
    });

    it("falls back to the raw HTML when conversion fails", async () => {
      convertFailure.next = new Error("parser blew up");
      replyWith({ body: DOC, headers: { "content-type": HTML } });
      const result = await run({ url: PAGE });
      const [first] = result.content;
      const text = first?.type === "text" ? first.text : "";
      expect(text).toContain("<main><h1>Hello</h1>");
      expect(text).toContain("[Couldn't convert the HTML (parser blew up); showing it raw]");
      expect(result.details).toMatchObject({ converted: false });
    });
  });

  describe('format: "html"', () => {
    const DOC = "<html><head><title>Docs</title></head><body><main><h1>Hello</h1></main></body></html>";

    it("returns the page source as is", async () => {
      replyWith({ body: DOC, headers: { "content-type": "text/html" } });
      const result = await run({ url: PAGE, format: "html" });
      const [first] = result.content;
      expect(first?.type === "text" && first.text).toContain(DOC);
      expect(result.details).toMatchObject({ format: "html", converted: false });
    });
  });

  describe("local addresses", () => {
    it("refuses a local address without fetching, and points to curl", async () => {
      await expect(run({ url: "http://127.0.0.1:5173/" })).rejects.toThrow(/not a public address.*use curl in bash/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("reports a refusal at connect time with its reason, not as a failed fetch", async () => {
      const reason = "rebind.example resolves to 127.0.0.1, which is not a public address.";
      const cause = Object.assign(new Error(reason), { code: "EBLOCKED" });
      fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause }));
      const pending = run({ url: "https://rebind.example/" });
      await expect(pending).rejects.toThrow(reason);
      await expect(pending).rejects.not.toThrow(/fetch failed/);
    });
  });

  describe("redirects", () => {
    it("follows a relative Location from the current URL", async () => {
      replyWith({ status: 302, headers: { location: "moved?x=1" } }, { body: "landed" });
      expect(await textOf({ url: PAGE })).toContain("landed");
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://example.com/moved?x=1");
    });

    it("cancels each redirect's body", async () => {
      const { stream, state } = trackedStream([new TextEncoder().encode("Moved")]);
      fetchMock.mockResolvedValueOnce(response({ body: stream, status: 302, headers: { location: "/next" } }));
      await run({ url: PAGE });
      expect(state.cancelled).toBe(true);
    });

    it("refuses a redirect to a local address before fetching it", async () => {
      replyWith({ status: 302, headers: { location: "http://127.0.0.1:8080/admin" } });
      await expect(run({ url: PAGE })).rejects.toThrow(/127\.0\.0\.1 is not a public address/);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("refuses a redirect to a scheme other than http(s)", async () => {
      replyWith({ status: 302, headers: { location: "file:///etc/passwd" } });
      await expect(run({ url: PAGE })).rejects.toThrow(/Only http: and https:/);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("gives up after 10 redirects", async () => {
      fetchMock.mockImplementation(async () => response({ status: 302, headers: { location: "/loop" } }));
      await expect(run({ url: PAGE })).rejects.toThrow(/more than 10 redirects/);
      expect(fetchMock).toHaveBeenCalledTimes(11);
    });

    it("treats a 3xx without a Location as an error", async () => {
      replyWith({ status: 300 });
      await expect(run({ url: PAGE })).rejects.toThrow(/HTTP 300/);
    });
  });

  describe("the connector", () => {
    it("checks addresses when connections open, and redirects by hand", async () => {
      await run({ url: PAGE });
      expect(net.agents[0]?.options).toEqual({ connect: { lookup: publicLookup } });
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown };
      expect(init.redirect).toBe("manual");
      expect(init.dispatcher).toBeDefined();
    });

    it("closes its connections on shutdown, and a second shutdown is harmless", () => {
      const tool = webFetchTool();
      tool.shutdown?.();
      tool.shutdown?.();
      expect(net.agents.at(-1)?.closed).toBe(2);
    });
  });

  describe("the definition", () => {
    const { definition } = webFetchTool();

    it("is read-only and open-world, so plan-build allows it without asking", () => {
      expect(definition.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    });
  });
});
