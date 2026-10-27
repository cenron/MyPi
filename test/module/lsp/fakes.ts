import { fileURLToPath } from "node:url";
import type { ServerSpec } from "#module/lsp/servers";

/** The fake language server; see the modes at its top. */
export const FAKE_SERVER = fileURLToPath(new URL("./fake-server.mjs", import.meta.url));

/** A spec that runs the fake server in `mode` for `.ts` files, rooted at the nearest `package.json`. */
export function fakeSpec(mode = "ok", overrides: Partial<ServerSpec> = {}): ServerSpec {
  return {
    id: "fake",
    language: "Fake",
    command: process.execPath,
    args: [FAKE_SERVER, mode],
    languageIds: { ".ts": "typescript" },
    rootMarkers: ["package.json"],
    install: "npm i -g fake-server",
    ...overrides,
  };
}

/** A tool as these tests call it: `execute` with the call's parameters and a context holding only `cwd`. */
type CallableTool = { execute(...args: never[]): Promise<{ content: { type: string; text?: string }[] }> };

/** Runs `tool` with `params`, its session folder `cwd`; the text it returns, or `ERROR: <message>` when it throws. */
export async function textOrError(tool: CallableTool, params: Record<string, unknown>, cwd: string): Promise<string> {
  try {
    const execute = tool.execute as (...args: unknown[]) => ReturnType<CallableTool["execute"]>;
    const [first] = (await execute("1", params, undefined, undefined, { cwd })).content;
    return first?.type === "text" ? (first.text ?? "") : "";
  } catch (error) {
    return `ERROR: ${(error as Error).message}`;
  }
}
