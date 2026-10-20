import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ASK_USER, askUserTool, OWN_ANSWER } from "#module/plan-build/tools/ask-user";

type Option = { label: string; description?: string };

/** Runs ask_user with `select` and `input` answering as given; undefined is Esc or an abort. */
async function ask(
  options: Option[],
  { hasUI = true, pick, type }: { hasUI?: boolean; pick?: string; type?: string } = {},
) {
  const select = vi.fn(async (_title: string, _options: string[], _opts?: unknown) => pick);
  const input = vi.fn(async (_title: string, _placeholder?: string, _opts?: unknown) => type);
  const signal = new AbortController().signal;
  const ctx = { hasUI, ui: { select, input } } as unknown as ExtensionToolContext;
  const result = await askUserTool().execute("call-1", { question: "Which DB?", options }, signal, undefined, ctx);
  const first = result.content[0];
  return { text: first?.type === "text" ? first.text : "", answer: result.details.answer, select, input, signal };
}

const options: Option[] = [{ label: "SQLite", description: "one file, no server" }, { label: "Postgres" }];

describe("askUserTool", () => {
  // Active only in Plan, like submit_plan; a direct tool is otherwise active as soon as it's registered.
  it("is ask_user, starts inactive, and runs one call at a time", () => {
    const tool = askUserTool();
    expect(tool.name).toBe(ASK_USER);
    expect(tool.defaultActive).toBe(false);
    expect(tool.executionMode).toBe("sequential");
  });

  it("lists the answers, descriptions on their line, then the own-answer entry, and passes the signal", async () => {
    const { select, signal } = await ask(options);
    expect(select).toHaveBeenCalledWith("Which DB?", ["SQLite — one file, no server", "Postgres", OWN_ANSWER], {
      signal,
    });
  });

  it("returns the picked answer's label, without its description", async () => {
    await expect(ask(options, { pick: "SQLite — one file, no server" })).resolves.toMatchObject({
      text: "The user picked: SQLite",
      answer: "SQLite",
    });
  });

  it("asks for text when the user picks their own answer", async () => {
    const { text, answer, input, signal } = await ask(options, { pick: OWN_ANSWER, type: "  DuckDB \n" });
    expect(input).toHaveBeenCalledWith("Which DB?", undefined, { signal });
    expect({ text, answer }).toEqual({ text: "The user answered: DuckDB", answer: "DuckDB" });
  });

  it("goes straight to text when there are no answers to pick from", async () => {
    const { select, answer } = await ask([], { type: "Whatever's simplest" });
    expect(select).not.toHaveBeenCalled();
    expect(answer).toBe("Whatever's simplest");
  });

  it.each([
    ["Esc in the list", { pick: undefined }],
    ["Esc in the text input", { pick: OWN_ANSWER, type: undefined }],
    ["an empty answer", { pick: OWN_ANSWER, type: "   " }],
  ])("says the user dismissed it on %s", async (_case, answers) => {
    await expect(ask(options, answers)).resolves.toMatchObject({
      text: "The user dismissed the question without answering.",
      answer: undefined,
    });
  });

  it("tells the model to decide itself without a UI", async () => {
    const { text, select } = await ask(options, { hasUI: false });
    expect(text).toContain("Decide yourself");
    expect(select).not.toHaveBeenCalled();
  });
});
