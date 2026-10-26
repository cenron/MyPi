import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenTask, Problem } from "#core/channels";
import { answer } from "#core/events";
import type { Project } from "#core/worktree/index";
import { DoneCheckModule } from "#module/done-check/index";
import { approve } from "#module/done-check/project-commands";
import { fakeSession } from "../../fakes";

let dir: string;
const execute = promisify(execFile);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "mypi-done-check-"));
  await writeFile(join(dir, "old.ts"), "");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/**
 * The module over a fake session in `dir`, with plan-build's `mode` and LSP's `diagnostics` answered by the test:
 * `problems` gives each check's answer.
 */
function start(
  options: {
    mode?: "plan" | "build";
    problems?: (files: readonly string[]) => Problem[];
    openTasks?: OpenTask[];
    project?: Project;
  } = {},
) {
  const fake = fakeSession([], dir, options.project);
  const events = fake.session.pi.events;
  let mode = options.mode ?? "build";
  answer(events, "mode", "plan-build", () => mode);
  const diagnostics = vi.fn(({ files }: { files: readonly string[] }) => options.problems?.(files) ?? []);
  answer(events, "diagnostics", "lsp", diagnostics);
  answer(events, "openTasks", "todo-test", () => options.openTasks ?? []);
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
  it("doesn't check files ignored by the project's Git repository", async () => {
    await execute("git", ["init"], { cwd: dir });
    await writeFile(join(dir, ".gitignore"), "coverage/\n");
    const { runTurn, diagnostics } = start({ project: { main: dir, commonDir: dir } });

    await runTurn(async () => {
      await writeNew("src.ts");
      await mkdir(join(dir, "coverage"));
      await writeNew("coverage/index.js");
    });

    expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({ files: [join(dir, "src.ts")] }));
  });

  it("warns once when Git cannot list ignored files and still checks the changes", async () => {
    const { runTurn, notify, diagnostics } = start({ project: { main: dir, commonDir: dir } });
    await runTurn(() => writeNew("a.ts"));
    await runTurn(() => writeNew("b.ts"));

    expect(diagnostics).toHaveBeenCalledTimes(2);
    expect(
      notify.mock.calls.filter(([message]) => String(message).includes("couldn't list ignored files")),
    ).toHaveLength(1);
  });

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

  it("reports open tasks and continues when the Build run changed no files", async () => {
    const { runTurn, diagnostics } = start({
      openTasks: [{ id: "2", subject: "Write tests", status: "pending" }],
    });

    expect(await runTurn()).toEqual({
      entries: [
        {
          type: "custom_message",
          customType: "mypi-done-check",
          content: expect.stringContaining("1 task still open:\n#2 [pending] Write tests"),
          display: true,
        },
      ],
      continue: true,
    });
    expect(diagnostics).not.toHaveBeenCalled();
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
    expect(await runTurn(() => writeNew())).toMatchObject({
      entries: [{ content: expect.stringContaining("Done check passed") }],
    });
    expect(notify).toHaveBeenCalledWith("Done check: broken couldn't check: server crashed", "warning");
  });

  it("appends a pass line without continuing when the checks found nothing", async () => {
    const { runTurn } = start();

    expect(await runTurn(() => writeNew())).toEqual({
      entries: [
        {
          type: "custom_message",
          customType: "mypi-done-check",
          content: expect.stringContaining("Done check passed"),
          display: true,
        },
      ],
    });
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

describe("the project's commands", () => {
  let agentDir: string;
  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "mypi-done-agent-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(agentDir, { recursive: true, force: true });
  });

  const listCommands = async (...commands: string[]) => {
    await mkdir(join(dir, ".pi"), { recursive: true });
    await writeFile(join(dir, ".pi/done-check.json"), JSON.stringify({ commands }));
  };
  const FAILING = "echo boom; exit 1";

  it("uses repository approval while reading configuration and executing in the active cwd", async () => {
    await listCommands("pwd; exit 1");
    const commonDir = join(dir, "common-git");
    await approve(`git:${commonDir}`, ["pwd; exit 1"]);
    const { runTurn, select } = start({ project: { main: "/not-the-active-checkout", commonDir } });
    expect(await runTurn(() => writeNew())).toMatchObject({
      entries: [{ content: expect.stringContaining(await realpath(dir)) }],
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("asks before running a new list, then runs it unasked and sends its failures back", async () => {
    await listCommands(FAILING);
    const { runTurn, select } = start();
    select.mockResolvedValueOnce("Yes");

    expect(await runTurn(() => writeNew())).toMatchObject({ continue: true });
    expect(select.mock.calls[0]?.[0]).toBe(`Done check: run these after each Build run in ${dir}?\n  ${FAILING}`);
    const report = await runTurn(() => writeNew("other.ts"));
    expect(report).toMatchObject({
      entries: [{ content: expect.stringContaining(`\`${FAILING}\` failed (exit 1):\n    boom`) }],
    });
    expect(select).toHaveBeenCalledOnce();
  });

  it("asks again when the list changes", async () => {
    await listCommands("true");
    const { runTurn, select } = start();
    select.mockResolvedValue("Yes");
    await runTurn(() => writeNew());

    await listCommands("true", FAILING);
    expect(await runTurn(() => writeNew("other.ts"))).toMatchObject({ continue: true });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("runs nothing after No, and doesn't ask again this session", async () => {
    await listCommands(FAILING);
    const { runTurn, select } = start();
    select.mockResolvedValue("No");

    expect(await runTurn(() => writeNew())).toMatchObject({
      entries: [{ content: expect.stringContaining("Done check passed") }],
    });
    expect(await runTurn(() => writeNew("other.ts"))).toMatchObject({
      entries: [{ content: expect.stringContaining("Done check passed") }],
    });
    expect(select).toHaveBeenCalledOnce();
  });

  it.each([
    ["the list isn't approved and there's no UI to ask", () => listCommands(FAILING), false, "aren't approved"],
    ["the file isn't a list of commands", () => writeFile(join(dir, ".pi/done-check.json"), "{}"), true, "must hold"],
  ])("runs nothing, and warns once, when %s", async (_case, setUp, hasUI, warning) => {
    await mkdir(join(dir, ".pi"), { recursive: true });
    await setUp();
    const { emit, notify, session } = start();
    const ctx = { ...session.ctx, hasUI };
    for (const name of ["a.ts", "b.ts"]) {
      await emit("before_agent_start", { type: "before_agent_start" }, ctx);
      await writeNew(name);
      expect(
        await emit("agent_before_settle", { type: "agent_before_settle", outcome: "completed" }, ctx),
      ).toMatchObject({ entries: [{ content: expect.stringContaining("Done check passed") }] });
    }
    expect(notify.mock.calls).toEqual([[expect.stringContaining(warning), "warning"]]);
  });
});
