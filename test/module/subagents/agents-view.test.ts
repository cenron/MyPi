import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { afterEach, expect, it, vi } from "vitest";
import type { AgentDefinition } from "#module/subagents/agents";
import { agentsCmd } from "#module/subagents/agents-view";
import { plainTheme as theme } from "../../fakes";

type Factory = (
  tui: { requestRender: () => void },
  theme: Theme,
  keys: unknown,
  done: (result: unknown) => void,
) => Component;
const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function fixture(agents: AgentDefinition[], options: { keys?: string[]; editor?: string; confirm?: boolean } = {}) {
  const folder = mkdtempSync(join(tmpdir(), "mypi-agents-view-"));
  folders.push(folder);
  const trace: string[] = [];
  const ui = makeContext(options, trace);
  const callbacks = { agents: () => agents, cwd: () => folder, userDir: () => folder, reload: vi.fn() };
  const command = agentsCmd(callbacks);
  return { folder, ui, callbacks, command, trace };
}

function makeContext(options: { keys?: string[]; editor?: string; confirm?: boolean } = {}, trace: string[] = []) {
  let component: Component | undefined;
  let customCalls = 0;
  const snapshots: string[] = [];
  const editor = vi.fn(async (_title: string, prefill?: string) => {
    trace.push("editor");
    if (prefill) snapshots.push(prefill);
    return options.editor;
  });
  const confirm = vi.fn(async () => {
    trace.push("confirm");
    return options.confirm ?? true;
  });
  const custom = vi.fn(
    (factory: Factory) =>
      new Promise<unknown>((resolve) => {
        customCalls++;
        let closed = false;
        component = factory({ requestRender: vi.fn() }, theme, {}, (result) => {
          closed = true;
          trace.push("overlay-closed");
          resolve(result);
        });
        if (customCalls === 1) {
          snapshots.push(component.render(110).join("\n"));
          for (const key of options.keys ?? []) {
            component.handleInput?.(key);
            snapshots.push(component.render(110).join("\n"));
          }
        }
        for (let attempt = 0; !closed && attempt < 2; attempt++) component.handleInput?.("\x1b");
      }),
  );
  return {
    editor,
    confirm,
    snapshots,
    get component() {
      return component;
    },
    ctx: { mode: "tui", ui: { custom, editor, confirm } } as unknown as ExtensionCommandContext,
  };
}

const explore: AgentDefinition = {
  name: "explore",
  description: "Search many files",
  access: "read-only",
  model: "inherit",
  thinking: "inherit",
  prompt: "Explore carefully.",
  source: "builtin",
  path: "/builtins/explore.md",
};

it("lists agents and shows the full selected definition and effective tools", async () => {
  const { command, ui } = fixture([explore, { ...explore, name: "writer", access: "write" }], {
    keys: ["\r", "\x1b"],
  });
  await command.execute(ui.ctx, []);

  expect(ui.snapshots[0]).toContain("explore · builtin · inherit · inherit · read-only");
  expect(ui.snapshots[1]).toContain("Path: /builtins/explore.md");
  expect(ui.snapshots[1]).toContain("Tools: read, grep, find, ls, bash");
  expect(ui.snapshots[1]).toContain("Explore carefully.");
  const writerView = fixture([{ ...explore, access: "write" }], { keys: ["\r"] });
  await writerView.command.execute(writerView.ui.ctx, []);
  expect(writerView.ui.snapshots[1]).toContain("Tools: pi's default tools");
});

it("refuses deletion of a builtin", async () => {
  const { command, ui, callbacks, trace } = fixture([explore], { keys: ["d"] });
  await command.execute(ui.ctx, []);

  expect(ui.component?.render(110).join("\n")).toContain("can't be deleted");
  expect(callbacks.reload).not.toHaveBeenCalled();
  expect(trace).not.toContain("confirm");
});

it("creates a user agent only after the overlay closes", async () => {
  const text = "---\nname: notes\ndescription: Keep notes\naccess: read-only\n---\nWrite concise notes";
  const { folder, command, ui, callbacks, trace } = fixture([], { keys: ["n"], editor: text });
  await command.execute(ui.ctx, []);

  expect(ui.editor).toHaveBeenCalledWith("New agent", expect.stringContaining('name: "new-agent"'));
  expect(ui.snapshots.at(-1)).toContain('name: "new-agent"');
  expect(trace.indexOf("overlay-closed")).toBeLessThan(trace.indexOf("editor"));
  expect(callbacks.reload).toHaveBeenCalledOnce();
  expect(ui.component?.render(110).join("\n")).toContain("Agent definitions reloaded.");
  expect(readFileSync(join(folder, "notes.md"), "utf8")).toContain("Write concise notes");
});

it("does not save an edit that fails to parse", async () => {
  const { folder, command, ui, callbacks } = fixture([{ ...explore, source: "user", path: "/tmp/explore.md" }], {
    keys: ["e"],
    editor: "not frontmatter",
  });
  await command.execute(ui.ctx, []);

  expect(callbacks.reload).not.toHaveBeenCalled();
  expect(ui.component?.render(110).join("\n")).toContain("missing or invalid field 'name'");
  expect(() => readFileSync(join(folder, "explore.md"), "utf8")).toThrow();
});

it.each([
  ["builtin", "user"],
  ["project", "project"],
] as const)("edits a %s definition into the %s folder", async (source, destination) => {
  const root = mkdtempSync(join(tmpdir(), "mypi-agents-view-scope-"));
  folders.push(root);
  const agent: AgentDefinition = { ...explore, source, path: join(root, `${explore.name}.md`) };
  const text = "---\nname: explore\ndescription: Changed role\naccess: read-only\n---\nUpdated prompt";
  const ui = makeContext({ keys: ["e"], editor: text });
  const callbacks = { agents: () => [agent], cwd: () => root, userDir: () => join(root, "user"), reload: vi.fn() };

  await agentsCmd(callbacks).execute(ui.ctx, []);

  const folder = destination === "user" ? callbacks.userDir() : join(root, ".pi", "agents");
  expect(readFileSync(join(folder, "explore.md"), "utf8")).toContain("Updated prompt");
  expect(callbacks.reload).toHaveBeenCalledOnce();
});

it("renames a user agent without leaving its old file", async () => {
  const folder = mkdtempSync(join(tmpdir(), "mypi-agents-view-rename-"));
  folders.push(folder);
  const oldPath = join(folder, "notes.md");
  writeFileSync(oldPath, "previous definition");
  const agent: AgentDefinition = { ...explore, name: "notes", source: "user", path: oldPath };
  const text = "---\nname: research-notes\ndescription: Search notes\naccess: read-only\n---\nSummarize.";
  const ui = makeContext({ keys: ["e"], editor: text });
  const callbacks = { agents: () => [agent], cwd: () => folder, userDir: () => folder, reload: vi.fn() };

  await agentsCmd(callbacks).execute(ui.ctx, []);

  expect(readFileSync(join(folder, "research-notes.md"), "utf8")).toContain("Summarize.");
  expect(() => readFileSync(oldPath, "utf8")).toThrow();
});

it("refuses an edit whose new name belongs to another agent", async () => {
  const folder = mkdtempSync(join(tmpdir(), "mypi-agents-view-collision-"));
  folders.push(folder);
  const agent: AgentDefinition = { ...explore, name: "notes", source: "user", path: join(folder, "notes.md") };
  const existing = { ...explore, name: "reviewer" };
  const text = "---\nname: reviewer\ndescription: Collision\naccess: read-only\n---\nMust not save.";
  const ui = makeContext({ keys: ["e"], editor: text });
  const callbacks = { agents: () => [agent, existing], cwd: () => folder, userDir: () => folder, reload: vi.fn() };

  await agentsCmd(callbacks).execute(ui.ctx, []);

  expect(callbacks.reload).not.toHaveBeenCalled();
  expect(ui.component?.render(110).join("\n")).toContain("already exists; choose another name");
  expect(() => readFileSync(join(folder, "reviewer.md"), "utf8")).toThrow();
});

it("confirms deletion after the overlay closes", async () => {
  const folder = mkdtempSync(join(tmpdir(), "mypi-agents-view-delete-"));
  folders.push(folder);
  const path = join(folder, "notes.md");
  writeFileSync(path, "previous definition");
  const notes: AgentDefinition = { ...explore, name: "notes", source: "user", path };
  const { command, ui, callbacks, trace } = fixture([notes], { keys: ["d"] });
  await command.execute(ui.ctx, []);

  expect(ui.confirm).toHaveBeenCalledWith("Delete notes?", `Delete ${path}?`);
  expect(trace.indexOf("overlay-closed")).toBeLessThan(trace.indexOf("confirm"));
  expect(callbacks.reload).toHaveBeenCalledOnce();
  expect(() => readFileSync(path, "utf8")).toThrow();
});

// Seen live: cancelling an edit reopened the list on the first row, so the next `d` hit the wrong agent.
it("reopens the list on the agent the user was on", async () => {
  const notes: AgentDefinition = { ...explore, name: "notes", source: "user", path: "/tmp/notes.md" };
  const { command, ui } = fixture([explore, notes], { keys: ["\x1b[B", "e"], editor: undefined });

  await command.execute(ui.ctx, []);

  expect(ui.component?.render(110).join("\n")).toMatch(/→ notes/);
});
