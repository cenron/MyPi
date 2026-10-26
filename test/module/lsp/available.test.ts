import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { availableLanguages } from "#module/lsp/available";
import type { ServerStatus } from "#module/lsp/manager";
import { fakeSpec } from "./fakes";

let folder: string | undefined;

afterEach(async () => {
  if (folder !== undefined) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

describe("availableLanguages", () => {
  it.each([
    ["installed, on, and rooted", true, true, true, ["Fake"]],
    ["not installed", false, true, true, []],
    ["off", true, false, true, []],
    ["not rooted", true, true, false, []],
  ])("counts a server only when %s", async (_rule, installed, on, rooted, expected) => {
    folder = await mkdtemp(join(tmpdir(), "mypi-lsp-available-"));
    if (rooted) await writeFile(join(folder, "package.json"), "{}");
    const spec = fakeSpec();
    const status = {
      spec,
      path: installed ? "/bin/fake" : undefined,
      on,
      running: [],
      starting: [],
      failed: [],
    } satisfies ServerStatus;

    expect(availableLanguages([status], folder)).toEqual(expected);
  });
});
