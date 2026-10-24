/** A language server MyPi can start: how to run it, which files it serves, and how to install it. */
export type ServerSpec = {
  /** Saved in the session when the server is turned off, so keep it stable. */
  id: string;
  /** What the `/lsp` menu shows. */
  language: string;
  /** A name on `PATH`, or an absolute path. */
  command: string;
  args: readonly string[];
  /** File extensions, with the dot, that pick this server. */
  extensions: readonly string[];
  /** Files that mark a project root; the nearest folder holding one is where the server starts. */
  rootMarkers: readonly string[];
  /** Start in the outermost marked folder instead, for a server meant to run once per workspace. */
  outermostRoot?: boolean;
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
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
    install: "npm i -g typescript (version 7 or later)",
  },
  {
    // gopls talks over stdio when given no arguments. One per workspace: the go.work folder holds every module.
    id: "go",
    language: "Go",
    command: "gopls",
    args: [],
    extensions: [".go"],
    rootMarkers: ["go.work", "go.mod"],
    outermostRoot: true,
    install: "go install golang.org/x/tools/gopls@latest",
  },
] as const satisfies readonly ServerSpec[];
