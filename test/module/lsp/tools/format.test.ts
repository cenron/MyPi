import { describe, expect, it } from "vitest";
import type { Lookup } from "#module/lsp/manager";
import { capAnswer, displayPath, MAX_ANSWER_CHARS, unavailable } from "#module/lsp/tools/format";
import { fakeSpec } from "../fakes";

describe("capAnswer", () => {
  it("keeps every block that fits", () => {
    expect(capAnswer("2 symbols:", ["a", "b"], "Narrow it.")).toBe("2 symbols:\na\nb");
  });

  it("leaves out whole blocks past the cap, and says how many and how to narrow", () => {
    const block = "x".repeat(MAX_ANSWER_CHARS / 4);
    const text = capAnswer("5 symbols:", [block, block, block, block, block], "Narrow it.");
    expect(text.length).toBeLessThan(MAX_ANSWER_CHARS + 200);
    expect(text).toMatch(/\n\nCut at 20000 characters: 2 of 5 symbols not shown\. Narrow it\.$/);
  });
});

describe("displayPath", () => {
  it.each([
    ["relative inside the folder", "/project/src/a.ts", "src/a.ts"],
    ["absolute outside it", "/elsewhere/a.ts", "/elsewhere/a.ts"],
  ])("is %s", (_case, file, shown) => {
    expect(displayPath(file, "/project")).toBe(shown);
  });
});

// The exact wording lives here; the tool's tests match key phrases.
describe("unavailable", () => {
  const spec = fakeSpec("ok", { language: "TypeScript", command: "tsc", install: "npm i -g typescript" });
  it.each<[string, Exclude<Lookup, { kind: "ready" }>, string]>([
    ["no server", { kind: "no_server", extension: ".md" }, "No language server for .md files. Read the file instead."],
    [
      "not installed",
      { kind: "missing", spec },
      "TypeScript language server isn't installed (tsc not found on PATH). Tell the user to install it with: " +
        "npm i -g typescript, then try again. Don't install it yourself.",
    ],
    ["off", { kind: "off", spec }, "TypeScript is turned off in /lsp. Ask the user to turn it on there."],
    [
      "failed",
      { kind: "failed", spec, root: "/p", error: "boom" },
      "TypeScript language server failed to start in /p: boom\nTell the user to fix it, then press Save in /lsp to retry.",
    ],
    ["stopped", { kind: "stopped", spec }, "TypeScript language server stopped with the session."],
  ])("explains %s", (_case, lookup, text) => {
    expect(unavailable(lookup)).toBe(text);
  });
});
