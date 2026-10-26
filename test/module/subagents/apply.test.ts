import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { answer } from "#core/events";
import { subagentApplyTool } from "#module/subagents/tools/apply";
import { PATCHES_DIR } from "#module/subagents/writer";
import { fakeSession } from "../../fakes";

const execute = promisify(execFile);
const roots: string[] = [];

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execute("git", args, { cwd, encoding: "utf8" })).stdout;
}

async function fixture(nested = false) {
  const root = await mkdtemp(join(tmpdir(), "mypi-subagent-apply-"));
  roots.push(root);
  await git(root, "init", "-b", "main");
  await git(root, "config", "user.name", "Fixture");
  await git(root, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(root, "file.txt"), "one\ntwo\nthree\n");
  await git(root, "add", "-A");
  await git(root, "commit", "-m", "base");

  const patches = join(root, PATCHES_DIR);
  await mkdir(patches, { recursive: true });
  await writeFile(join(root, "file.txt"), "writer\ntwo\nthree\n");
  await git(root, "add", "file.txt");
  const patch = await git(root, "diff", "--cached", "--binary", "HEAD");
  await writeFile(join(patches, "sub-developer-1.patch"), patch);
  await writeFile(
    join(patches, "sub-developer-1.md"),
    "# developer\n\n## Task\nChange the file\nextra detail\n\n## Base commit\nabc\n\n## Files\n- file.txt\n\n## Diff stat\n file.txt | 2 +-\n\n## Patch\npatch path\n\n## Summary\nChanged it.\nMore details.\n",
  );
  await git(root, "reset", "--hard", "HEAD");

  const cwd = nested ? join(root, "nested") : root;
  if (nested) await mkdir(cwd);
  const fake = fakeSession([], cwd, { main: root, commonDir: join(root, ".git") });
  const tool = subagentApplyTool(fake.session);
  const call = (name = "sub-developer-1") =>
    tool.execute("call", { name } as never, undefined, undefined, fake.session.ctx as never);
  return { root, patches, fake, tool, call };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("says when to call and not to apply through bash", async () => {
  const { tool } = await fixture();
  expect(tool.description).toBe(
    "After a write subagent's result names a patch, call this to show it to the user, who applies or drops it. " +
      "Never apply a patch with `git apply` in `bash`. It applies only after the user's approval, or drops the patch.",
  );
});

it("lists available patches for an unknown or invalid name", async () => {
  const { call } = await fixture();
  await expect(call("missing")).rejects.toThrow("Available patches: sub-developer-1.");
  await expect(call("../patches/sub-developer-1")).rejects.toThrow(
    "No patch '../patches/sub-developer-1'. Available patches: sub-developer-1.",
  );
});

it("refuses Plan mode before showing the approval dialog", async () => {
  const {
    call,
    fake,
    fake: { select },
  } = await fixture();
  answer(fake.session.pi.events, "mode", "plan-test", () => "plan");
  await expect(call()).rejects.toThrow("Switch to Build");
  expect(select).not.toHaveBeenCalled();
});

it("refuses without UI because user approval is required", async () => {
  const { call, fake } = await fixture();
  (fake.session.ctx as unknown as { hasUI: boolean }).hasUI = false;
  await expect(call()).rejects.toThrow("needs the user's approval, and no one can give it here (no UI)");
});

it("asks with patch details, applies with three-way merge, and removes the handoff", async () => {
  const { call, fake, root, patches } = await fixture();
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue(APPLY);
  const response = await call();
  const [title, choices] = fake.select.mock.calls[0] ?? [];
  expect(title).toContain("Apply the developer patch?");
  expect(title).toContain("Change the file");
  expect(title).toContain("file.txt | 2 +-");
  expect(title).toContain("Changed it.");
  expect(choices).toEqual(["Cancel", "Apply", "Drop"]);
  expect(response.content[0]).toMatchObject({ type: "text", text: "Applied sub-developer-1. Files: file.txt." });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("writer\ntwo\nthree\n");
  await expect(readFile(join(patches, "sub-developer-1.patch"))).rejects.toThrow();
  await expect(readFile(join(patches, "sub-developer-1.md"))).rejects.toThrow();
});

it("reports a clash without changing the checkout and keeps the patch and handoff", async () => {
  const { call, fake, root, patches } = await fixture();
  await writeFile(join(root, "file.txt"), "other\ntwo\nthree\n");
  await git(root, "add", "file.txt");
  await git(root, "commit", "-m", "other edit");
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue(APPLY);
  const response = await call();
  expect(response.content[0]).toMatchObject({
    type: "text",
    text: expect.stringContaining(
      "Could not apply sub-developer-1; the patch was kept.\nApplied patch to 'file.txt' with conflicts.",
    ),
  });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("other\ntwo\nthree\n");
  expect(await git(root, "ls-files", "-u", "--", "file.txt")).toBe("");
  await expect(readFile(join(patches, "sub-developer-1.patch"))).resolves.toBeTruthy();
  await expect(readFile(join(patches, "sub-developer-1.md"))).resolves.toBeTruthy();
});

it("applies project-root patches when pi starts in a nested directory", async () => {
  const { call, fake, root } = await fixture(true);
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue(APPLY);

  const response = await call();

  expect(response.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Applied") });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("writer\ntwo\nthree\n");
});

it("merges a non-conflicting checkout change with the patch's base", async () => {
  const { call, fake, root } = await fixture();
  await writeFile(join(root, "file.txt"), "one\ntwo\nmain edit\n");
  await git(root, "add", "file.txt");
  await git(root, "commit", "-m", "independent edit");
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue(APPLY);

  const response = await call();

  expect(response.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Applied") });
  expect(await readFile(join(root, "file.txt"), "utf8")).toBe("writer\ntwo\nmain edit\n");
});

it("drops both files when selected", async () => {
  const { call, fake, patches } = await fixture();
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue(DROP);
  await call();
  await expect(readFile(join(patches, "sub-developer-1.patch"))).rejects.toThrow();
  await expect(readFile(join(patches, "sub-developer-1.md"))).rejects.toThrow();
});

it("keeps both files when cancelled or dismissed", async () => {
  const { call, fake, patches } = await fixture();
  vi.mocked(fake.session.ctx.ui.select).mockResolvedValue("Cancel");
  const response = await call();
  expect(response.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Cancelled") });
  await expect(readFile(join(patches, "sub-developer-1.patch"))).resolves.toBeTruthy();
  await expect(readFile(join(patches, "sub-developer-1.md"))).resolves.toBeTruthy();
});

const APPLY = "Apply";
const DROP = "Drop";
