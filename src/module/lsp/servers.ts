import { extname } from "node:path";

/** A language server MyPi can start: how to run it, which files it serves, and how to install it. */
export type ServerSpec = {
  /** Saved in the session when the server is turned off, so keep it stable. */
  id: string;
  /** What the `/lsp` menu shows. */
  language: string;
  /** A name on `PATH`, or an absolute path. */
  command: string;
  args: readonly string[];
  /** File extensions, with the dot, that pick this server, each with the language id it's opened as. */
  languageIds: Readonly<Record<string, string>>;
  /** Files that mark a project root; the nearest folder holding one is where the server starts. */
  rootMarkers: readonly string[];
  /** Start in the outermost marked folder instead, for a server meant to run once per workspace. */
  outermostRoot?: boolean;
  /**
   * What a project-wide search needs first, for a server that isn't ready once started: `open_file` opens a project
   * file (the server searches nothing until one is open); `wait_for_index` asks again while an empty answer may only
   * mean it's still indexing. Opening a file there would make the first answer cover only that file.
   */
  beforeSearch?: "open_file" | "wait_for_index";
  /** Shown when `command` can't be found. */
  install: string;
};

/** The servers MyPi knows. Adding a language is one entry here. */
export const SERVERS = [
  {
    // TypeScript 7's own server. typescript-language-server wraps tsserver, which TypeScript 7 no longer ships.
    id: "typescript",
    language: "TypeScript",
    command: "tsc",
    args: ["--lsp", "--stdio"],
    languageIds: {
      ".ts": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".tsx": "typescriptreact",
      ".js": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".jsx": "javascriptreact",
    },
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    beforeSearch: "open_file",
    install: "npm i -g typescript (version 7 or later)",
  },
  {
    // gopls talks over stdio when given no arguments. One per workspace: the go.work folder holds every module.
    id: "go",
    language: "Go",
    command: "gopls",
    args: [],
    languageIds: { ".go": "go" },
    rootMarkers: ["go.work", "go.mod"],
    outermostRoot: true,
    install: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "python",
    language: "Python",
    command: "pyright-langserver",
    args: ["--stdio"],
    languageIds: { ".py": "python", ".pyi": "python" },
    beforeSearch: "wait_for_index",
    rootMarkers: ["pyrightconfig.json", "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
    install: "npm i -g pyright",
  },
] as const satisfies readonly ServerSpec[];

/** The language id `file` is opened as by `spec`, or undefined when `spec` doesn't serve it. */
export function languageIdOf(spec: ServerSpec, file: string): string | undefined {
  const extension = extname(file);
  // An own-property check: a plain object finds `constructor` and the like on its prototype.
  return Object.hasOwn(spec.languageIds, extension) ? spec.languageIds[extension] : undefined;
}
