import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { truncate } from "#tool/web-fetch/truncate";

/** `writeFile` fails once when set, to test a full text that can't be saved. */
const writeFailure = vi.hoisted(() => ({ next: undefined as Error | undefined }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      const error = writeFailure.next;
      writeFailure.next = undefined;
      return error ? Promise.reject(error) : actual.writeFile(...args);
    },
  };
});

/** Files a test saved, removed after it. */
const saved: string[] = [];
afterEach(async () => {
  await Promise.all(saved.splice(0).map((path) => rm(path, { force: true })));
});

const manyLines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i}`).join("\n");

describe("truncate", () => {
  it("cuts past 2000 lines and saves the whole text, readable only by the user", async () => {
    const text = manyLines(2500);
    const result = await truncate(text, ".md");
    const path = result.fullTextPath ?? "";
    saved.push(path);
    expect(path.startsWith(tmpdir())).toBe(true);
    expect(path).toMatch(/pi-web-fetch-[0-9a-f]{16}\.md$/);
    expect(await readFile(path, "utf8")).toBe(text);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("line 1999");
    expect(result.text).not.toContain("line 2000");
    expect(
      result.text.endsWith(
        `[Truncated: showed 2000 of 2500 lines. The full text is in ${path}; read it for the rest.]`,
      ),
    ).toBe(true);
  });

  it("keeps the first 50KB of a single line too long to cut at a line end", async () => {
    const result = await truncate("x".repeat(200 * 1024), ".json");
    saved.push(result.fullTextPath ?? "");
    expect(result.text.startsWith("x".repeat(50 * 1024))).toBe(true);
    expect(result.text).toContain("[Truncated: showed the first 50.0KB of 200.0KB. The full text is in ");
  });

  it("still cuts, without a path, when the full text can't be saved", async () => {
    writeFailure.next = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const result = await truncate(manyLines(2500), ".txt");
    expect(result.fullTextPath).toBeUndefined();
    expect(result.truncated).toBe(true);
    expect(result.text.endsWith("[Truncated: showed 2000 of 2500 lines.]")).toBe(true);
  });
});
