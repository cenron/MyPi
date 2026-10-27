import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerManager } from "#module/lsp/manager";
import type { ServerSpec } from "#module/lsp/servers";
import { lspTool } from "#module/lsp/tools/lsp";
import { fakeSpec, textOrError } from "../fakes";

let dir: string;
let servers: ServerManager | undefined;

// The fake server reads `class|method|function <name>` lines as symbols; other lines are only uses of names.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-nav-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(
    join(dir, "src/server.ts"),
    "class ServerManager\n  method touch\nfunction main\n  call touch here\n",
  );
  await writeFile(join(dir, "src/other.ts"), "class Other\n  method touch\n// uses ServerManager touch\n");
});

afterEach(async () => {
  await servers?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

/** Runs the tool, its session folder `cwd`; the text it returns, or the error it throws. */
async function run(params: Record<string, unknown>, spec: ServerSpec = fakeSpec(), cwd = dir): Promise<string> {
  servers = new ServerManager([spec], dir, () => {});
  return textOrError(lspTool(servers), params, cwd);
}

describe("lsp references", () => {
  // tsc keeps its own copy of files that aren't open, so a change on disk must be reported first.
  it("tells the server what changed on disk before it answers", async () => {
    const report = vi.spyOn(ServerManager.prototype, "reportDiskChanges");
    await run({ action: "references", path: "src/server.ts", name_path: "ServerManager/touch" });
    expect(report).toHaveBeenCalledOnce();
    report.mockRestore();
  });

  it("lists each use by file and line, with its code", async () => {
    expect(await run({ action: "references", path: "src/server.ts", name_path: "ServerManager/touch" })).toBe(
      [
        "3 references to ServerManager/touch (src/server.ts:2):",
        "src/other.ts:2  method touch",
        "src/other.ts:3  // uses ServerManager touch",
        "src/server.ts:4  call touch here",
      ].join("\n"),
    );
  });

  it("says when there are none, and where a use may be counted instead", async () => {
    expect(await run({ action: "references", path: "src/server.ts", name_path: "main" })).toBe(
      "No references to main (src/server.ts:3) found. A use through a subclass or an override counts for that " +
        "symbol instead; try references on it.",
    );
  });

  it("asks again while a wait_for_index server is still indexing", async () => {
    const spec = fakeSpec("slow-index", { beforeSearch: "wait_for_index" });
    const params = { action: "references", path: "src/server.ts", name_path: "ServerManager/touch" };
    expect(await run(params, spec)).toMatch(/^3 references to ServerManager\/touch/);
  });

  // The folder guard's line: lsp shows code only from inside the session's folder.
  it("names places outside the session's folder without their code", async () => {
    await writeFile(join(dir, "lib.ts"), "touch\n");
    const text = await run(
      { action: "references", path: "server.ts", name_path: "ServerManager/touch" },
      fakeSpec(),
      join(dir, "src"),
    );
    expect(text).toContain(`\n${join(dir, "lib.ts")}:1\n`);
    expect(text).toContain("other.ts:2  method touch");
    expect(text).toMatch(/Places outside .+ are shown without their code; read them to see it\.$/);
  });

  it.each([
    ["no symbol matches", "Nope", "No symbol matches Nope in src/server.ts. Check the file's outline"],
    ["several symbols match", "touch", "2 symbols match touch in src/other.ts; pass a longer name path"],
  ])("fails when %s, saying what to pass", async (_case, namePath, message) => {
    const path = namePath === "touch" ? "src/other.ts" : "src/server.ts";
    await writeFile(join(dir, "src/other.ts"), "class Other\n  method touch\nfunction touch\n");
    expect(await run({ action: "references", path, name_path: namePath })).toContain(message);
  });

  it.each([
    ["without a file", { action: "references", name_path: "touch" }, "references needs a path to a file."],
    ["for a folder", { action: "references", path: "src", name_path: "touch" }, "references needs a file; src is"],
    ["without a name path", { action: "references", path: "src/server.ts" }, "references needs a name_path"],
  ])("fails %s", async (_case, params, message) => {
    expect(await run(params)).toContain(message);
  });
});

describe("lsp implementations", () => {
  it("lists what implements the symbol", async () => {
    expect(await run({ action: "implementations", path: "src/server.ts", name_path: "ServerManager/touch" })).toBe(
      "1 implementation of ServerManager/touch (src/server.ts:2):\nsrc/other.ts:2  method touch",
    );
  });

  it("says when there are none", async () => {
    expect(await run({ action: "implementations", path: "src/server.ts", name_path: "main" })).toBe(
      "No implementations of main (src/server.ts:3) found.",
    );
  });

  it("fails for a server that doesn't find implementations", async () => {
    const params = { action: "implementations", path: "src/server.ts", name_path: "ServerManager/touch" };
    expect(await run(params, fakeSpec("no-impl"))).toContain(
      "The Fake server doesn't find implementations; try references instead.",
    );
  });
});

describe("lsp definition", () => {
  it("gives the symbol a name's first use leads to, with its source on request", async () => {
    expect(await run({ action: "definition", path: "src/other.ts", name: "ServerManager", include_body: true })).toBe(
      [
        "1 definition of ServerManager, used at src/other.ts:3:",
        "class ServerManager  src/server.ts:1-2",
        "class ServerManager\n  method touch\n",
      ].join("\n"),
    );
  });

  it.each([
    ["after the symbol", "ServerManager", "Other", "ServerManager isn't used in src/other.ts, in Other."],
    ["before the symbol", "Other", "Other/touch", "Other isn't used in src/other.ts, in Other/touch."],
  ])("looks for the name only inside the symbol name_path names, not %s", async (_case, name, namePath, message) => {
    expect(await run({ action: "definition", path: "src/other.ts", name, name_path: namePath })).toBe(
      `ERROR: ${message}`,
    );
  });

  it("says when the server finds no definition", async () => {
    expect(await run({ action: "definition", path: "src/server.ts", name: "here" })).toMatch(
      /^No definition found for here at src\/server\.ts:4\. If that's in a comment or a string/,
    );
  });

  it.each([
    ["without a name", { action: "definition", path: "src/server.ts" }, "definition needs a name, as used"],
    ["for more than one name", { action: "definition", path: "src/server.ts", name: "a.b" }, "name must be one"],
  ])("fails %s", async (_case, params, message) => {
    expect(await run(params)).toContain(message);
  });
});
