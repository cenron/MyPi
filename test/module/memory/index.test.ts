import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "#core/session";
import type { Verdict } from "#core/tool-guard";
import { ModuleLoadMode } from "#core/types";
import { MemoryModule } from "#module/memory/index";
import { fakeSession } from "../../fakes";

/** The module's prompt section, as the next run would send it. */
function promptSection(session: Session) {
  const sections: Record<string, string> = {};
  session.promptManager.apply(sections);
  return sections["mypi-memory"];
}

/** A `tool_result` event, as pi sends it after a tool ran. */
function toolResult(toolName: string, path: string, isError = false) {
  return { type: "tool_result", toolCallId: "1", toolName, input: { path }, content: [], isError, details: undefined };
}

const toolCall = { type: "tool_call", toolCallId: "1", toolName: "read", input: {} } as ToolCallEvent;

const MEMORY = "---\ndescription: How I like to work\n---\n";

describe("MemoryModule", () => {
  let agentDir: string;
  let cwd: string;
  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "mypi-agent-"));
    cwd = await mkdtemp(join(tmpdir(), "mypi-cwd-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(agentDir, { recursive: true, force: true });
    await chmod(cwd, 0o700);
    await rm(cwd, { recursive: true, force: true });
  });

  const projectDir = () => join(cwd, ".pi", "memories");
  const globalDir = () => join(agentDir, "memories");

  /** A started module over a fake session in `cwd`. */
  function startMemory() {
    const fake = fakeSession([], cwd);
    new MemoryModule(fake.session).init();
    return fake;
  }

  it("is always loaded, with /onboard and /memory-check", () => {
    const module = new MemoryModule(fakeSession().session);
    expect(module.info.loadType).toBe(ModuleLoadMode.ALWAYS);
    expect(module.info.commands.map((command) => command.name)).toEqual(["onboard", "memory-check"]);
    expect(module.commands().map((command) => command.info.name)).toEqual(["onboard", "memory-check"]);
  });

  it("registers both folders as writable in a read-only mode", async () => {
    const { session } = startMemory();
    const seen = vi.fn((): Verdict => ({ kind: "allow" }));
    session.toolGuard.set("spy", seen);
    await session.toolGuard.check(toolCall, { cwd, hasUI: false } as ExtensionContext);

    expect(seen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ writableDirs: [projectDir(), globalDir()] }),
    );
  });

  // Reads the folders when run, so it sees a file written after the module started.
  it("reports what /memory-check finds in both folders now", async () => {
    const fake = fakeSession([], cwd);
    const module = new MemoryModule(fake.session);
    module.init();
    await mkdir(globalDir());
    await writeFile(join(globalDir(), "style.md"), `${MEMORY}See [[missing]].\n`);

    const check = module.commands().find((command) => command.info.name === "memory-check");
    const report = await check?.execute({} as never, []);
    expect(report).toContain(`${join(globalDir(), "style")}.md: broken links: [[missing]]`);
  });

  it("lists the cwd's project memories and the agent dir's global ones in its prompt section", async () => {
    await mkdir(globalDir());
    await writeFile(join(globalDir(), "style.md"), MEMORY);
    const { session } = startMemory();

    const prompt = promptSection(session);
    expect(prompt).toContain(`Project memories (${projectDir()}):\n(none yet)`);
    expect(prompt).toContain(`Global memories (${globalDir()}):\n- style — How I like to work`);
  });

  it("warns about a folder it can't read and still sets the section", async () => {
    await writeFile(globalDir(), "a file, not a folder");
    const { session, notify } = startMemory();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("can't read"), "warning");
    expect(promptSection(session)).toContain("(this folder can't be read)");
  });

  it("refreshes the list after a write under the global folder", async () => {
    const { session, emit } = startMemory();
    await mkdir(globalDir());
    await writeFile(join(globalDir(), "style.md"), MEMORY);
    await emit("tool_result", toolResult("write", join(globalDir(), "style.md")));

    expect(promptSection(session)).toContain("- style — How I like to work");
  });

  // The path is relative, so this also checks it resolves against the context's cwd.
  it("keeps the project folder out of git and refreshes after an edit there", async () => {
    const { session, emit } = startMemory();
    await mkdir(projectDir(), { recursive: true });
    await writeFile(join(projectDir(), "build.md"), MEMORY);
    await emit("tool_result", toolResult("edit", ".pi/memories/build.md"));

    expect(await readFile(join(projectDir(), ".gitignore"), "utf8")).toBe("*\n");
    expect(promptSection(session)).toContain("- build — How I like to work");
  });

  it.each([
    ["a failed write", toolResult("write", ".pi/memories/build.md", true)],
    ["a read", toolResult("read", ".pi/memories/build.md")],
    ["a write outside both folders", toolResult("write", "notes/build.md")],
  ])("does nothing after %s", async (_case, event) => {
    const { session, emit } = startMemory();
    await mkdir(projectDir(), { recursive: true });
    await writeFile(join(projectDir(), "build.md"), MEMORY);
    await emit("tool_result", event);

    expect(promptSection(session)).toContain(`Project memories (${projectDir()}):\n(none yet)`);
    await expect(access(join(projectDir(), ".gitignore"))).rejects.toThrow();
  });

  it("warns when the project folder can't be kept out of git, and still refreshes", async () => {
    const { session, emit, notify } = startMemory();
    await mkdir(projectDir(), { recursive: true });
    await writeFile(join(projectDir(), "build.md"), MEMORY);
    await chmod(projectDir(), 0o500);
    try {
      await emit("tool_result", toolResult("write", join(projectDir(), "build.md")));
    } finally {
      await chmod(projectDir(), 0o700);
    }

    expect(notify).toHaveBeenCalledWith(expect.stringContaining(".gitignore"), "warning");
    expect(promptSection(session)).toContain("- build — How I like to work");
  });
});
