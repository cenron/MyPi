import { fileURLToPath } from "node:url";
import { isNodeError } from "#core/util/errors";
import { isInside } from "#core/util/paths";
import { findSourceFile } from "#core/util/walk";
import type { ReadyLookup, ServerManager } from "../manager";
import { languageIdOf } from "../servers";
import { lastName, matchesNamePath, type NamedSymbol, plainName } from "../symbols";
import { afterIndexing, fileSymbols, ready } from "./document";
import { capAnswer, counted, displayPath, lineSpan, symbolLine, unavailable } from "./format";

/** Most files a project search opens to check full name paths; the answer says when there were more. */
const MAX_SEARCH_FILES = 20;

const NARROW = "Narrow the call: pass a file or folder as path, a longer name path, or leave out include_body.";

/** A symbol found in a file, with that file's text for its body. */
type Match = { file: string; text: string; symbol: NamedSymbol };

/** A project search's matches, and how many candidate files it didn't open. */
type Found = { matches: Match[]; unchecked: number };

/** A find_symbol request: the name path, and whether to add each match's source. */
export type Query = { pattern: string; withBody: boolean };

export async function outline(
  servers: ServerManager,
  file: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { client, spec } = ready(await servers.clientFor(file));
  const { symbols } = await fileSymbols(client, spec, file, signal);
  const where = displayPath(file, cwd);
  if (symbols.length === 0) return `The ${spec.language} server lists no symbols in ${where}.`;

  const lines = symbols.map((symbol) => "  ".repeat(symbol.depth) + symbolLine(symbol, lineSpan(symbol)));
  return capAnswer(
    `${counted(symbols.length, "symbol")} in ${where}:`,
    lines,
    "symbol",
    "Narrow the call: use find_symbol for one of them.",
  );
}

export async function findInFile(
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
export async function findInProject(
  servers: ServerManager,
  query: Query,
  dir: string,
  narrow: boolean,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { readies, others } = await projectsAt(servers, dir, cwd);
  const inside = narrow ? dir : undefined;
  const found = await searchProjects(readies, query.pattern, inside, signal);

  const where = readies.map((lookup) => {
    const project = `the ${lookup.spec.language} project in ${lookup.root}`;
    return inside === undefined || inside === lookup.root ? project : `${displayPath(inside, cwd)}, in ${project}`;
  });
  const notSearched = others.map((lookup) => `Not searched: ${unavailable(lookup)}`);
  return [answer(found, query, where, cwd), ...notSearched].join("\n\n");
}

/**
 * The file that declares the symbol `pattern` names, searched for in `dir` (only inside it with `narrow`), for the
 * actions that start from a declaration. Models pass a folder there as often as a file. Throws, listing what it found,
 * unless exactly one symbol matches.
 */
export async function declaringFile(
  servers: ServerManager,
  pattern: string,
  dir: string,
  narrow: boolean,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { readies } = await projectsAt(servers, dir, cwd);
  const { matches } = await searchProjects(readies, pattern, narrow ? dir : undefined, signal);
  const [only] = matches;
  if (matches.length === 1 && only) return only.file;

  const where = displayPath(dir, cwd);
  if (matches.length === 0)
    throw new Error(`No symbol matches ${pattern} in ${where}; pass the file that declares it.`);
  const places = matches.map(({ file, symbol }) => `  ${symbol.path.join("/")} (${displayPath(file, cwd)})`);
  throw new Error(
    `${matches.length} symbols match ${pattern} in ${where}; pass one's file as path:\n${places.join("\n")}`,
  );
}

/** A symbol's source lines from the text the server read. */
export function body(text: string, { start, end }: NamedSymbol): string {
  return text
    .split("\n")
    .slice(start, end + 1)
    .join("\n");
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
  const header = `${counted(found.matches.length, "symbol")} ${verb} ${query.pattern} in ${place}:`;
  return capAnswer(header, blocks, "symbol", NARROW) + unchecked;
}

/** The language server projects `dir` is in, split into the ones ready to search and the rest. */
async function projectsAt(servers: ServerManager, dir: string, cwd: string) {
  const lookups = await servers.projectClients(dir);
  if (lookups.length === 0) {
    throw new Error(
      `No language server's project files (such as package.json or go.mod) at or above ${displayPath(dir, cwd)}; ` +
        "pass a file, or a folder inside a project, as path.",
    );
  }

  const readies = lookups.filter((lookup): lookup is ReadyLookup => lookup.kind === "ready");
  const others = lookups.filter((lookup) => lookup.kind !== "ready");
  if (readies.length === 0) throw new Error(others.map(unavailable).join("\n"));
  return { readies, others };
}

/** Every ready project's matches for `pattern`, and how many candidate files weren't opened. */
async function searchProjects(
  readies: readonly ReadyLookup[],
  pattern: string,
  inside: string | undefined,
  signal?: AbortSignal,
): Promise<Found> {
  const found: Found = { matches: [], unchecked: 0 };
  for (const lookup of readies) {
    const result = await searchProject(lookup, pattern, inside, signal);
    found.matches.push(...result.matches);
    found.unchecked += result.unchecked;
  }
  return found;
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

  const files = (await afterIndexing(lookup, () => candidateFiles(lookup, lastName(pattern), signal), signal)).filter(
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

/** The files holding a symbol named `name`, from the server's project search. */
async function candidateFiles({ client }: ReadyLookup, name: string, signal?: AbortSignal): Promise<string[]> {
  const symbols = await client.workspaceSymbols(name, signal);
  const uris = symbols
    .filter((symbol) => plainName(symbol.name) === name && symbol.location.uri.startsWith("file:"))
    .map((symbol) => symbol.location.uri);
  return [...new Set(uris)].map((uri) => fileURLToPath(uri));
}
