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
