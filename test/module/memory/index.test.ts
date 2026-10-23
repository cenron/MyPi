import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "#core/session";
import { ModuleLoadMode } from "#core/types";
import { MemoryModule } from "#module/memory/index";
import { fakeSession } from "../../fakes";

/** The module's prompt section, as the next run would send it. */
function promptSection(session: Session) {
  const sections: Record<string, string> = {};
  session.promptManager.apply(sections);
  return sections["mypi-memory"];
}

describe("MemoryModule", () => {
  let agentDir: string;
  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "mypi-agent-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(agentDir, { recursive: true, force: true });
  });

  it("is always loaded", () => {
    expect(new MemoryModule(fakeSession().session).info.loadType).toBe(ModuleLoadMode.ALWAYS);
  });

  it("lists the cwd's project memories and the agent dir's global ones in its prompt section", async () => {
    await mkdir(join(agentDir, "memories"));
    await writeFile(join(agentDir, "memories", "style.md"), "---\ndescription: How I like to work\n---\n");
    const { session } = fakeSession();
    new MemoryModule(session).init();

    const prompt = promptSection(session);
    expect(prompt).toContain("Project memories (/project/.pi/memories):\n(none yet)");
    expect(prompt).toContain(`Global memories (${join(agentDir, "memories")}):\n- style — How I like to work`);
  });

  it("warns about a folder it can't read and still sets the section", async () => {
    await writeFile(join(agentDir, "memories"), "a file, not a folder");
    const { session, notify } = fakeSession();
    new MemoryModule(session).init();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("can't read"), "warning");
    expect(promptSection(session)).toContain("(this folder can't be read)");
  });
});
