import { formatSize } from "@earendil-works/pi-coding-agent";
import { errorMessage, isNodeError } from "#core/util/errors";

/** Text types that `text/*`, `+json`, and `+xml` don't cover. */
const TEXTUAL_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
]);

/**
 * Reads `response`'s body into one buffer of at most `maxBytes`. Throws before reading when `Content-Length` is over
 * the cap, and cancels the stream as soon as the body passes it, so a huge page is never downloaded in full. A response
 * with no body (a 204 or a HEAD) gives empty bytes.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("Content-Length");
  const length = contentLength === null ? null : Number(contentLength);
  let total = 0;

  if (length !== null && Number.isSafeInteger(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Response is over ${formatSize(maxBytes)}`);
  }

  if (response.body === null) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response is over ${formatSize(maxBytes)}`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks, total);
}

/**
 * `signal` combined with a timeout of `ms`: either one aborts the request. On timeout the reason is a
 * `DOMException` named `TimeoutError`; on `signal`'s abort it's `signal`'s own reason, so callers can tell them apart.
 * `signal` may be `undefined`, as pi's tool signal can be.
 */
export function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * The MIME type alone from a `Content-Type` value, trimmed and lowercased: `text/html; charset=utf-8` gives
 * `text/html`. An empty value gives `""`.
 */
export function mimeOf(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/**
 * True for content types that hold text: `text/*`, JSON, XML, JavaScript, or none given (OpenCode's `isTextual`).
 * `mime` is the type alone, as from `mimeOf`.
 */
export function isTextual(mime: string): boolean {
  return (
    mime === "" ||
    mime.startsWith("text/") ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml") ||
    TEXTUAL_TYPES.has(mime)
  );
}

/**
 * True for image types a model can't read as text. SVG is the exception: it's XML, so it counts as text instead.
 * `mime` is the type alone, as from `mimeOf`.
 */
export function isImage(mime: string): boolean {
  return mime.startsWith("image/") && mime !== "image/svg+xml";
}

/** Decodes `bytes` with the `charset` from `contentType`, falling back to UTF-8 when it's missing or unknown. */
export function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch (error) {
    // TextDecoder throws a RangeError for a label it doesn't know.
    if (!(error instanceof RangeError)) throw error;
    return new TextDecoder().decode(bytes);
  }
}

/** Frees the connection, then fails with `message`: for a response whose body won't be read. */
export async function failWith(response: Response, message: string): Promise<never> {
  await response.body?.cancel();
  throw new Error(message);
}

/**
 * Why a fetch failed, in a few words: "timed out after 30s" for a `timeoutSignal` timeout, the message plus the
 * network code ("fetch failed (ENOTFOUND)"), or the error's own message. `seconds` is the timeout that was set.
 */
export function describeFetchError(error: unknown, seconds: number): string {
  if (error instanceof Error && error.name === "TimeoutError") return `timed out after ${seconds}s`;
  // Node's fetch only says "fetch failed"; the cause has the code, such as ENOTFOUND.
  const cause = error instanceof Error ? error.cause : undefined;
  if (isNodeError(cause) && cause.code) return `${errorMessage(error)} (${cause.code})`;
  return errorMessage(error);
}
