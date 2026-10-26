import type { ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerRules, updatePromptPaths } from "#rule/index";
import { fakeSession } from "../fakes";

// No UI, so an ask comes back as a block that lists the question.
const ctx = { cwd: "/project", hasUI: false } as ExtensionContext;
const read = (path: string) =>
  ({ type: "tool_call", toolCallId: "1", toolName: "read", input: { path } }) as ToolCallEvent;

describe("registerRules", () => {
  it("puts the folder rule on the session's guard", async () => {
    const { session } = fakeSession([], "/project");
    registerRules(session.toolGuard);
    await expect(session.toolGuard.check(read("src/a.ts"), ctx)).resolves.toBeUndefined();
    await expect(session.toolGuard.check(read("/home/me/notes.md"), ctx)).resolves.toEqual({
      block: true,
      reason: expect.stringContaining("folder-guard: Reaches outside /project: /home/me/notes.md"),
    });
  });

  it("approves trees across tools until a fresh session registers its rules", async () => {
    const { session } = fakeSession([], "/project");
    registerRules(session.toolGuard);
    const select = vi.fn(async () => "Allow for this session");
    const interactive = { ...ctx, hasUI: true, ui: { select } } as unknown as ExtensionContext;
    const bash = (command: string) => ({ ...read(""), toolName: "bash", input: { command } }) as ToolCallEvent;
    await expect(session.toolGuard.check(bash("ls /elsewhere/tree"), interactive)).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);

    await expect(session.toolGuard.check(read("/elsewhere/tree/sub/file.md"), interactive)).resolves.toBeUndefined();
    await expect(
      session.toolGuard.check(bash("cat /elsewhere/tree/a /elsewhere/tree/sub/b"), interactive),
    ).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledTimes(1);

    await session.toolGuard.check(read("/elsewhere/other"), interactive);
    expect(select).toHaveBeenCalledTimes(2);

    const fresh = fakeSession([], "/project").session;
    registerRules(fresh.toolGuard);
    await fresh.toolGuard.check(bash("ls /elsewhere/tree"), interactive);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("allows the places pi's prompt points at, once they're filled in", async () => {
    const { session } = fakeSession([], "/project");
    const prompt = registerRules(session.toolGuard);
    await expect(session.toolGuard.check(read("/home/me/AGENTS.md"), ctx)).resolves.toMatchObject({ block: true });

    updatePromptPaths(prompt, promptWith(["/home/me/AGENTS.md"]));
    await expect(session.toolGuard.check(read("/home/me/AGENTS.md"), ctx)).resolves.toBeUndefined();
  });
});

describe("updatePromptPaths", () => {
  it("fills the paths from each skill's folder and each context file", () => {
    const prompt = { paths: [] };
    updatePromptPaths(prompt, promptWith(["/w/AGENTS.md"], ["/s/herdr"]));
    expect(prompt.paths).toEqual(["/s/herdr", "/w/AGENTS.md"]);
  });

  it("fills them once: later prompts change nothing", () => {
    const prompt = { paths: [] };
    updatePromptPaths(prompt, promptWith(["/w/AGENTS.md"]));
    updatePromptPaths(prompt, promptWith(["/other/AGENTS.md"]));
    expect(prompt.paths).toEqual(["/w/AGENTS.md"]);
  });

  it("leaves them for the next run when a prompt lists nothing", () => {
    const prompt = { paths: [] };
    updatePromptPaths(prompt, promptWith([]));
    updatePromptPaths(prompt, promptWith(["/w/AGENTS.md"]));
    expect(prompt.paths).toEqual(["/w/AGENTS.md"]);
  });
});

/** pi's prompt options with these context files and skill folders. */
function promptWith(contextFiles: string[], skillDirs: string[] = []) {
  return {
    skills: skillDirs.map((baseDir) => ({ baseDir })),
    contextFiles: contextFiles.map((path) => ({ path, content: "" })),
  } as never;
}
