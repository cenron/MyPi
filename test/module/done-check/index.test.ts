import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Problem } from "#core/channels";
import { answer } from "#core/events";
import { DoneCheckModule } from "#module/done-check/index";
import { fakeSession } from "../../fakes";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-done-check-"));
  await writeFile(join(dir, "old.ts"), "");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/**
 * The module over a fake session in `dir`, with plan-build's `mode` and LSP's `diagnostics` answered by the test:
 * `problems` gives each check's answer.
 */
function start(options: { mode?: "plan" | "build"; problems?: (files: readonly string[]) => Problem[] } = {}) {
  const fake = fakeSession([], dir);
  const events = fake.session.pi.events;
  let mode = options.mode ?? "build";
  answer(events, "mode", "plan-build", () => mode);
  const diagnostics = vi.fn(({ files }: { files: readonly string[] }) => options.problems?.(files) ?? []);
  answer(events, "diagnostics", "lsp", diagnostics);
  new DoneCheckModule(fake.session).init();

  /** One run: starts it, lets `work` change files, then asks the check, as pi does before the run settles. */
  const runTurn = async (work: () => Promise<void> = async () => {}, outcome = "completed") => {
    await fake.emit("before_agent_start", { type: "before_agent_start" });
    await work();
    return settle(outcome);
  };
  const settle = (outcome = "completed") => fake.emit("agent_before_settle", { type: "agent_before_settle", outcome });
  const setMode = (next: "plan" | "build") => {
    mode = next;
  };
  return { ...fake, diagnostics, runTurn, settle, setMode };
}

const error = (file: string, message = "Cannot find name 'x'."): Problem => ({
  file,
  line: 3,
  column: 5,
  severity: "error",
  message,
  origin: "ts 2304",
});

const writeNew = (name = "new.ts") => writeFile(join(dir, name), "");

describe("DoneCheckModule", () => {
  it("sends the errors in the files a Build run changed back, and asks for one more model request", async () => {
    const { runTurn, diagnostics } = start({ problems: (files) => files.map((file) => error(file)) });

    expect(await runTurn(() => writeNew())).toEqual({
      entries: [
        {
          type: "custom_message",
          customType: "mypi-done-check",
          content:
            "Done check: 1 error in files changed during this run.\nnew.ts:3:5  Cannot find name 'x'. (ts 2304)\n" +
            "Fix these, or say why they're fine.",
          display: true,
        },
      ],
      continue: true,
    });
    // Only what the run changed: old.ts was there, untouched, before it started.
    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ files: [join(dir, "new.ts")] }));
  });

  it.each([
    ["the run changed no files", {}, async () => {}, "completed"],
    [
      "the run was aborted",
      { problems: (f: readonly string[]) => f.map((x) => error(x)) },
      () => writeNew(),
      "aborted",
    ],
    [
      "the run is in Plan",
      { mode: "plan" as const, problems: (f: readonly string[]) => f.map((x) => error(x)) },
      () => writeNew(),
      "completed",
    ],
  ])("stays quiet when %s", async (_case, options, work, outcome) => {
    expect(await start(options).runTurn(work, outcome)).toBeUndefined();
  });

  it("stays quiet after a switch to Plan during the run", async () => {
    const { runTurn, setMode } = start({ problems: (files) => files.map((file) => error(file)) });
    expect(
      await runTurn(async () => {
        await writeNew();
        setMode("plan");
      }),
    ).toBeUndefined();
  });

  it("stops when the same report comes back", async () => {
    const { runTurn, settle } = start({ problems: (files) => files.map((file) => error(file)) });
    expect(await runTurn(() => writeNew())).toMatchObject({ continue: true });
    expect(await settle()).toBeUndefined();
  });

  it("sends a run back at most 3 times", async () => {
    let round = 0;
    const { runTurn, settle } = start({ problems: (files) => files.map((file) => error(file, `error ${round++}`)) });
    expect(await runTurn(() => writeNew())).toMatchObject({ continue: true });
    expect(await settle()).toMatchObject({ continue: true });
    expect(await settle()).toMatchObject({ continue: true });
    expect(await settle()).toBeUndefined();

    // A new prompt starts a new run, with its own rounds.
    expect(await runTurn(() => writeNew("other.ts"))).toMatchObject({ continue: true });
  });

  it("tells the user when a source fails, and doesn't send the run back for it", async () => {
    const { session, runTurn, notify } = start();
    answer(session.pi.events, "diagnostics", "broken", () => {
      throw new Error("server crashed");
    });
    expect(await runTurn(() => writeNew())).toBeUndefined();
    expect(notify).toHaveBeenCalledWith("Done check: broken couldn't check: server crashed", "warning");
  });

  it("shows checking… in the footer while it checks", async () => {
    let footerDuring: unknown;
    const { runTurn, setStatus } = start({
      problems: () => {
        footerDuring = setStatus.mock.lastCall;
        return [];
      },
    });

    await runTurn(() => writeNew());
    expect(footerDuring).toEqual(["mypi-done-check", "<muted>checking…"]);
    expect(setStatus).toHaveBeenLastCalledWith("mypi-done-check", undefined);
  });
});
