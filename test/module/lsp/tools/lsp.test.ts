import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServerManager } from "#module/lsp/manager";
import type { ServerSpec } from "#module/lsp/servers";
import { lspTool } from "#module/lsp/tools/lsp";
import { fakeSpec } from "../fakes";

let dir: string;
let servers: ServerManager | undefined;

// A project the fake server reads: two .ts files with symbols, and a Markdown file no server serves.
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-lsp-tool-"));
  await mkdir(join(dir, "src"));
  await writeFile(join(dir, "package.json"), "{}");
  await writeFile(join(dir, "src/server.ts"), "class ServerManager\n  method touch\n  method stop\nfunction main\n");
  await writeFile(join(dir, "src/other.ts"), "class Other\n  method touch\n  method touched\n");
  await writeFile(join(dir, "notes.md"), "");
});

afterEach(async () => {
  await servers?.stopAll();
  await rm(dir, { recursive: true, force: true });
});

/** Runs the tool in the project with servers from `specs`; the text it returns, or the error it throws. */
async function run(params: Record<string, unknown>, ...specs: ServerSpec[]): Promise<string> {
  servers = new ServerManager(specs.length > 0 ? specs : [fakeSpec()], dir, () => {});
  const tool = lspTool(servers);
  try {
    const result = await tool.execute("1", params as never, undefined, undefined, { cwd: dir } as never);
    const [first] = result.content;
    return first?.type === "text" ? first.text : "";
  } catch (error) {
    return `ERROR: ${(error as Error).message}`;
  }
}

describe("lsp outline", () => {
  it("lists a file's symbols as a tree, with name paths and lines", async () => {
    expect(await run({ action: "outline", path: "src/server.ts" })).toBe(
      [
        "4 symbols in src/server.ts:",
        "class ServerManager  1-3",
        "  method ServerManager/touch  2",
        "  method ServerManager/stop  3",
        "function main  4",
      ].join("\n"),
    );
  });

  it.each([
    ["without a path", { action: "outline" }, "outline needs a path to a file."],
    ["for a folder", { action: "outline", path: "src" }, "outline needs a file; src is a folder."],
    ["for a file no server serves", { action: "outline", path: "notes.md" }, "No language server for .md files"],
  ])("fails %s", async (_case, params, message) => {
    expect(await run(params)).toContain(message);
  });
});

describe("lsp find_symbol", () => {
  it("finds a symbol in a file by name path, with its source on request", async () => {
    expect(await run({ action: "find_symbol", path: "src/server.ts", name_path: "/main", include_body: true })).toBe(
      "1 symbol matches /main in src/server.ts:\nfunction main  src/server.ts:4\nfunction main\n",
    );
  });

  it("searches the whole project, checking the full path in files it never opened", async () => {
    // The server also offers `touched`, a loose match: only exact names count.
    expect(await run({ action: "find_symbol", name_path: "touch" })).toBe(
      [
        `2 symbols match touch in the Fake project in ${dir}:`,
        "method Other/touch  src/other.ts:2",
        "method ServerManager/touch  src/server.ts:2",
      ].join("\n"),
    );
  });

  it("sees edits to files it opened before, in a later project search", async () => {
    servers = new ServerManager([fakeSpec()], dir, () => {});
    const tool = lspTool(servers);
    const search = async (namePath: string) => {
      const params = { action: "find_symbol" as const, name_path: namePath };
      const [first] = (await tool.execute("1", params, undefined, undefined, { cwd: dir } as never)).content;
      return first?.type === "text" ? first.text : "";
    };

    // The first search opens other.ts; the server then answers from the text it was sent, not the disk.
    expect(await search("Other/touch")).toMatch(/^1 symbol matches/);
    await writeFile(join(dir, "src/other.ts"), "class Other\n  method renamed\n");
    expect(await search("Other/renamed")).toMatch(/^1 symbol matches Other\/renamed/);
  });

  it("sees files created, edited, or deleted outside the agent, in a later project search", async () => {
    servers = new ServerManager([fakeSpec()], dir, () => {});
    const tool = lspTool(servers);
    const search = async (namePath: string) => {
      const params = { action: "find_symbol" as const, name_path: namePath };
      const [first] = (await tool.execute("1", params, undefined, undefined, { cwd: dir } as never)).content;
      return first?.type === "text" ? first.text : "";
    };

    // The first search makes the fake server read every file; it keeps that copy until told otherwise.
    expect(await search("main")).toMatch(/^1 symbol matches/);
    await new Promise((resolve) => setTimeout(resolve, 20)); // so modification times move
    await writeFile(join(dir, "src/extra.ts"), "function added\n");
    await writeFile(join(dir, "src/server.ts"), "function renamed\n");
    await rm(join(dir, "src/other.ts"));

    expect(await search("added")).toMatch(/^1 symbol matches added/);
    expect(await search("renamed")).toMatch(/^1 symbol matches renamed/);
    expect(await search("Other/touch")).toMatch(/^No symbol matches/);
  });

  it("skips a match in a file that's gone, when the server still offers it", async () => {
    servers = new ServerManager([fakeSpec("keeps-deleted")], dir, () => {});
    const tool = lspTool(servers);
    const search = async () => {
      const params = { action: "find_symbol" as const, name_path: "touch" };
      const [first] = (await tool.execute("1", params, undefined, undefined, { cwd: dir } as never)).content;
      return first?.type === "text" ? first.text : "";
    };

    expect(await search()).toMatch(/^2 symbols match/);
    await rm(join(dir, "src/other.ts"));
    expect(await search()).toBe(
      `1 symbol matches touch in the Fake project in ${dir}:\nmethod ServerManager/touch  src/server.ts:2`,
    );
  });

  it.each([
    ["searches only once a file is open (open_file)", fakeSpec("needs-open", { beforeSearch: "open_file" })],
    [
      "is still indexing just after it started (wait_for_index)",
      fakeSpec("slow-index", { beforeSearch: "wait_for_index" }),
    ],
  ])("finds symbols when the server %s", async (_case, spec) => {
    expect(await run({ action: "find_symbol", name_path: "Other/touch" }, spec)).toMatch(/^1 symbol matches/);
  });

  it("searches only inside a folder passed as path, from a session folder above the project", async () => {
    await mkdir(join(dir, "scripts"));
    await writeFile(join(dir, "scripts/run.ts"), "function main\n");

    expect(await run({ action: "find_symbol", name_path: "main" })).toMatch(/^2 symbols match main/);
    servers = new ServerManager([fakeSpec()], tmpdir(), () => {});
    const params = { action: "find_symbol" as const, name_path: "main", path: join(dir, "src") };
    const [first] = (await lspTool(servers).execute("1", params, undefined, undefined, { cwd: tmpdir() } as never))
      .content;
    // Paths show relative to the session folder, here the temp folder above the project.
    const project = relative(tmpdir(), dir);
    expect(first?.type === "text" && first.text).toBe(
      `1 symbol matches main in ${project}/src, in the Fake project in ${dir}:\nfunction main  ${project}/src/server.ts:4`,
    );
  });

  it("says no symbol matches, and where it looked", async () => {
    expect(await run({ action: "find_symbol", name_path: "ServerManager/nope" })).toMatch(
      /^No symbol matches ServerManager\/nope in the Fake project in .+\. A server may still be indexing/,
    );
  });

  it("notes the project's servers it couldn't search", async () => {
    const missing = fakeSpec("ok", { id: "py", language: "Python", command: "/nonexistent/x" });
    const text = await run({ action: "find_symbol", name_path: "main" }, fakeSpec(), missing);
    expect(text).toMatch(/^1 symbol matches main/);
    expect(text).toContain("Not searched: Python language server isn't installed");
  });

  it.each([
    ["without a name path", { action: "find_symbol" }, [fakeSpec()], "find_symbol needs a name_path"],
    [
      "when no server can search the project",
      { action: "find_symbol", name_path: "main" },
      [fakeSpec("ok", { command: "/nonexistent/x" })],
      "Don't install it yourself.",
    ],
    [
      "when no server's project files are in the folder",
      { action: "find_symbol", name_path: "main" },
      [fakeSpec("ok", { rootMarkers: ["go.mod"] })],
      "No language server's project files (such as package.json or go.mod) at or above",
    ],
  ])("fails %s", async (_case, params, specs, message) => {
    expect(await run(params, ...specs)).toContain(message);
  });
});
