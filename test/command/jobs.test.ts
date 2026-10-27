import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { jobsCmd } from "#command/jobs/index";
import { fakeSession, plainTheme as theme } from "../fakes";

type Factory = (tui: unknown, theme: Theme, keys: unknown, done: (result: undefined) => void) => Component;

function context(keys: string[] = []) {
  let component: Component | undefined;
  const custom = vi.fn(
    (factory: Factory) =>
      new Promise<undefined>((resolve) => {
        component = factory({ requestRender: vi.fn() }, theme, {}, resolve);
        for (const key of keys) component.handleInput?.(key);
        if (!keys.length) resolve(undefined);
      }),
  );
  return {
    custom,
    get component() {
      return component;
    },
    ctx: { mode: "tui", ui: { custom } } as unknown as ExtensionCommandContext,
  };
}

describe("/jobs", () => {
  it("says when there are no background jobs", async () => {
    const { session } = fakeSession();
    const ui = context();

    await jobsCmd(session).execute(ui.ctx, []);

    expect(ui.component?.render(110).join("\n")).toContain("No background jobs.");
  });

  it("shows the newest job first and opens its output", async () => {
    const { session } = fakeSession();
    const old = session.jobs.start({
      kind: "shell",
      label: "old job",
      run: async (_signal, write) => {
        write("old output");
        return 0;
      },
    });
    await old.done;
    const current = session.jobs.start({
      kind: "shell",
      label: "new job",
      run: async (_signal, write) => {
        write("new output");
        return 1;
      },
    });
    await current.done;
    const ui = context();

    await jobsCmd(session).execute(ui.ctx, []);
    const rows = ui.component?.render(110).join("\n") ?? "";
    expect(rows.indexOf("2 · shell")).toBeLessThan(rows.indexOf("1 · shell"));
    expect(rows).toContain("failed (exit 1)");
    ui.component?.handleInput?.("\r");

    expect(ui.component?.render(110).join("\n")).toContain("new output");
    expect(ui.component?.render(110).join("\n")).toContain(current.info.logPath);
    ui.component?.handleInput?.("\x1b");
    expect(ui.component?.render(110).join("\n")).toContain("Enter open");
  });

  it("stops a selected running job", async () => {
    const { session } = fakeSession();
    const job = session.jobs.start({
      kind: "shell",
      label: "sleep",
      run: async (signal) =>
        new Promise<number>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")))),
    });
    const { ctx } = context(["x"]);

    expect(await jobsCmd(session).execute(ctx, [])).toBe("Stopped job 1: sleep");
    expect((await job.done).status).toBe("stopped");
  });

  it("does not stop a job that ends while the view is open", async () => {
    const { session } = fakeSession();
    let finish!: (code: number) => void;
    const job = session.jobs.start({
      kind: "shell",
      label: "running",
      run: () => new Promise((resolve) => (finish = resolve)),
    });
    const stop = vi.spyOn(session.jobs, "stop");
    const ui = context();

    await jobsCmd(session).execute(ui.ctx, []);
    finish(0);
    await job.done;
    ui.component?.handleInput?.("x");

    expect(stop).not.toHaveBeenCalled();
    expect(ui.component?.render(110).join("\n")).toContain("completed");
  });

  it("refuses non-TUI command execution", async () => {
    const { session } = fakeSession();
    await expect(jobsCmd(session).execute({ mode: "rpc" } as ExtensionCommandContext, [])).rejects.toThrow(
      "requires TUI",
    );
  });
});
