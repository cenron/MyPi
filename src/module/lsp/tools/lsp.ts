import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isNodeError } from "#core/util/errors";
import { isInside, resolveToolPath } from "#core/util/paths";
import type { LspClient } from "../client";
import type { Lookup, ReadyLookup, ServerManager } from "../manager";
import { languageIdOf, type ServerSpec } from "../servers";
import { lastName, matchesNamePath, type NamedSymbol, namedSymbols, plainName } from "../symbols";
import { findSourceFile } from "../util/walk";
import { capAnswer, displayPath, lineSpan, symbolCount, symbolLine, unavailable } from "./format";

/** How long after a `wait_for_index` server starts an empty project search is asked again: Pyright takes seconds. */
const WARMUP_MS = 5_000;
const RETRY_MS = 500;
/** Most files a project search opens to check full name paths; the answer says when there were more. */
const MAX_SEARCH_FILES = 20;

const NARROW = "Narrow the call: pass a file or folder as path, a longer name path, or leave out include_body.";

const parameters = Type.Object({
  action: Type.Union([Type.Literal("outline"), Type.Literal("find_symbol")], {
    description: "outline: a file's symbols as a tree. find_symbol: where a symbol is, by name path.",
  }),
  path: Type.Optional(
    Type.String({
      description:
        "outline: the file (required). find_symbol: a file, or a folder inside a project, to search in; without it, " +
        "the project of the current folder is searched.",
    }),
  ),
  name_path: Type.Optional(
    Type.String({
      description:
        "For find_symbol. A symbol's names from the top of its file, joined with /: `touch` matches that name at any " +
        "depth, `ServerManager/touch` any path ending with it, `/ServerManager/touch` only from the top. Exact names.",
    }),
  ),
  include_body: Type.Optional(
    Type.Boolean({ description: "For find_symbol: add each match's source. Off by default." }),
  ),
});

/** A symbol found in a file, with that file's text for its body. */
type Match = { file: string; text: string; symbol: NamedSymbol };

/** A project search's matches, and how many candidate files it didn't open. */
type Found = { matches: Match[]; unchecked: number };

/**
 * The `lsp` tool: a file's outline, or where a symbol is by name path, from the language servers. Read-only, so Plan
 * mode allows it. Starts a server on first use.
 */
export function lspTool(servers: ServerManager) {
  const languages = servers.specs.map((spec) => spec.language).join(", ");

  return defineTool({
    name: "lsp",
    label: "LSP",
    description:
      `Code navigation from language servers (${languages}): outline a file, or find where a symbol is by name ` +
      "path, with its source on request. Exact where grep matches text; use it to see a file's shape or find a " +
      "definition without reading whole files.",
    promptSnippet: "Outline a file or find a symbol by name path, through language servers",
    parameters,
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = params.path === undefined ? undefined : resolveToolPath(params.path, ctx.cwd, homedir());
      const folder = path !== undefined && (await isFolder(path));
      let text: string;

      if (params.action === "outline") {
        if (path === undefined) throw new Error("outline needs a path to a file.");
        if (folder) throw new Error(`outline needs a file; ${params.path} is a folder.`);
        text = await outline(servers, path, ctx.cwd, signal);
      } else {
        if (!params.name_path) throw new Error("find_symbol needs a name_path, such as ServerManager/touch.");
        const query = { pattern: params.name_path, withBody: params.include_body === true };
        text =
          path !== undefined && !folder
            ? await findInFile(servers, query, path, ctx.cwd, signal)
            : await findInProject(servers, query, path ?? ctx.cwd, path !== undefined, ctx.cwd, signal);
      }

      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}

async function outline(servers: ServerManager, file: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const { client, spec } = ready(await servers.clientFor(file));
  const { symbols } = await fileSymbols(client, spec, file, signal);
  const where = displayPath(file, cwd);
  if (symbols.length === 0) return `The ${spec.language} server lists no symbols in ${where}.`;

  const lines = symbols.map((symbol) => "  ".repeat(symbol.depth) + symbolLine(symbol, lineSpan(symbol)));
  return capAnswer(
    `${symbolCount(symbols.length)} in ${where}:`,
    lines,
    "Narrow the call: use find_symbol for one of them.",
  );
}

type Query = { pattern: string; withBody: boolean };

async function findInFile(
  servers: ServerManager,
  query: Query,
  file: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { client, spec } = ready(await servers.clientFor(file));
  const { symbols, text } = await fileSymbols(client, spec, file, signal);
  const matches = symbols.filter((symbol) => matchesNamePath(symbol.path, query.pattern));
  return answer(
    { matches: matches.map((symbol) => ({ file, text, symbol })), unchecked: 0 },
    query,
    [displayPath(file, cwd)],
    cwd,
  );
}

/**
 * Searches the projects `dir` is in: one per server whose root markers are at or above it. With `narrow` (the agent
 * passed this folder), only matches inside `dir` count; otherwise the whole project does.
 */
async function findInProject(
  servers: ServerManager,
  query: Query,
  dir: string,
  narrow: boolean,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const lookups = await servers.projectClients(dir);
  if (lookups.length === 0) {
    throw new Error(
      `No language server's project files (such as package.json or go.mod) at or above ${displayPath(dir, cwd)}; ` +
        "pass a file, or a folder inside a project, as path.",
    );
  }

  const readies = lookups.filter((lookup) => lookup.kind === "ready");
  const others = lookups.filter((lookup) => lookup.kind !== "ready");
  if (readies.length === 0) throw new Error(others.map(unavailable).join("\n"));

  const inside = narrow ? dir : undefined;
  const found: Found = { matches: [], unchecked: 0 };
  for (const lookup of readies) {
    const result = await searchProject(lookup, query.pattern, inside, signal);
    found.matches.push(...result.matches);
    found.unchecked += result.unchecked;
  }

  const where = readies.map((lookup) => {
    const project = `the ${lookup.spec.language} project in ${lookup.root}`;
    return inside === undefined || inside === lookup.root ? project : `${displayPath(inside, cwd)}, in ${project}`;
  });
  const notSearched = others.map((lookup) => `Not searched: ${unavailable(lookup)}`);
  return [answer(found, query, where, cwd), ...notSearched].join("\n\n");
}

/** The answer to a `find_symbol`: a counted header, one block per match, and what wasn't checked. */
function answer(found: Found, query: Query, where: string[], cwd: string): string {
  const place = where.join(" and ");
  const unchecked =
    found.unchecked > 0
      ? `\n${found.unchecked} more candidate files weren't opened; pass one as path to check it.`
      : "";

  if (found.matches.length === 0) {
    return (
      `No symbol matches ${query.pattern} in ${place}. A server may still be indexing, or the name differs: try the ` +
      `outline of a likely file.${unchecked}`
    );
  }

  const blocks = found.matches.map(({ file, text, symbol }) => {
    const line = symbolLine(symbol, `${displayPath(file, cwd)}:${lineSpan(symbol)}`);
    return query.withBody ? `${line}\n${body(text, symbol)}\n` : line;
  });
  const verb = found.matches.length === 1 ? "matches" : "match";
  const header = `${symbolCount(found.matches.length)} ${verb} ${query.pattern} in ${place}:`;
  return capAnswer(header, blocks, NARROW) + unchecked;
}

/**
 * Searches a server's project for `pattern`: asks it for symbols named like the last name, then opens each file that
 * has one to check the whole path, after what the server needs first (`beforeSearch`). With `inside`, only files in
 * that folder count.
 */
async function searchProject(
  lookup: ReadyLookup,
  pattern: string,
  inside: string | undefined,
  signal?: AbortSignal,
): Promise<Found> {
  const { client, spec, root } = lookup;
  await client.syncOpen();
  if (spec.beforeSearch === "open_file" && !client.hasOpenDocuments) {
    const anchor = await findSourceFile(root, Object.keys(spec.languageIds));
    if (anchor) await fileSymbols(client, spec, anchor, signal);
  }

  const waitForIndex = spec.beforeSearch === "wait_for_index";
  const files = (await candidateFiles(client, lastName(pattern), waitForIndex, signal)).filter(
    (file) => languageIdOf(spec, file) && (inside === undefined || isInside(inside, file)),
  );
  const opened = files.slice(0, MAX_SEARCH_FILES);

  const matches: Match[] = [];
  for (const file of opened) {
    const found = await fileSymbols(client, spec, file, signal).catch((error: unknown) => {
      // Deleted since the server indexed it: nothing to match there.
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    for (const symbol of found?.symbols ?? []) {
      if (matchesNamePath(symbol.path, pattern)) matches.push({ file, text: found?.text ?? "", symbol });
    }
  }
  return { matches, unchecked: files.length - opened.length };
}

/**
 * The files holding a symbol named `name`, from the server's project search. With `waitForIndex`, an empty answer is
 * asked again until `WARMUP_MS` after the server started, since it may only be still indexing.
 */
async function candidateFiles(
  client: LspClient,
  name: string,
  waitForIndex: boolean,
  signal?: AbortSignal,
): Promise<string[]> {
  for (;;) {
    const symbols = await client.workspaceSymbols(name, signal);
    const uris = symbols
      .filter((symbol) => plainName(symbol.name) === name && symbol.location.uri.startsWith("file:"))
      .map((symbol) => symbol.location.uri);
    const files = [...new Set(uris)].map((uri) => fileURLToPath(uri));

    if (files.length > 0 || !waitForIndex || Date.now() - client.startedAt > WARMUP_MS) return files;
    await sleep(RETRY_MS, undefined, { signal });
  }
}

/** Sends `file` to the server and returns its symbols with name paths, and the text they were read from. */
async function fileSymbols(client: LspClient, spec: ServerSpec, file: string, signal?: AbortSignal) {
  const languageId = languageIdOf(spec, file);
  if (languageId === undefined) throw new Error(`The ${spec.language} server doesn't serve ${file}.`);

  const { uri, text } = await client.sync(file, languageId);
  const symbols = namedSymbols(await client.documentSymbols(uri, signal));
  return { symbols, text };
}

/** A symbol's source lines from the text the server read. */
function body(text: string, { start, end }: NamedSymbol): string {
  return text
    .split("\n")
    .slice(start, end + 1)
    .join("\n");
}

/** True when `path` is a folder; false for a file, or a path that doesn't exist (reading it reports that). */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The ready server, or an error that tells the agent what to ask the user. */
function ready(lookup: Lookup): ReadyLookup {
  if (lookup.kind !== "ready") throw new Error(unavailable(lookup));
  return lookup;
}
