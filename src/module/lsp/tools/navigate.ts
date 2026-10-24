import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Location, Position } from "vscode-languageserver-protocol/node";
import { isInside } from "#core/util/paths";
import type { ReadyLookup, ServerManager } from "../manager";
import { languageIdOf } from "../servers";
import type { NamedSymbol } from "../symbols";
import { afterIndexing, currentServer, type Document, fileSymbols, type Picked, pickSymbol } from "./document";
import { body } from "./find";
import { capAnswer, counted, displayPath, lineSpan, symbolLine } from "./format";

/** One name, as a definition is asked for: letters, digits, `_`, and `$`. */
const IDENTIFIER = /^[\p{L}\p{N}_$]+$/u;

/** Most characters of a code line shown next to a place. */
const MAX_CODE_CHARS = 200;

const SEE_REST = "Search the files not listed with grep.";

/** A definition request: the name as used in a file, inside the symbol at `within` when given. */
export type Usage = { file: string; name: string; within: string | undefined; withBody: boolean };

/** The lines a name is looked for in: a symbol's, with how to name it. */
type Lines = { start: number; end: number; label: string };

/** Where the symbol `pattern` names in `file` is used, across its project. */
export async function references(
  servers: ServerManager,
  file: string,
  pattern: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const picked = await pickSymbol(servers, file, pattern, cwd, signal);
  const { client } = picked.lookup;
  const { uri } = picked.document;
  const { at } = picked.symbol;

  // With its declarations, as servers count them, then without the symbol's own: tsc counts an import as one.
  const others = async () => {
    const all = await client.references(uri, at, signal);
    return all.filter((place) => !(place.uri === uri && samePosition(place.range.start, at)));
  };
  const places = await afterIndexing(picked.lookup, others, signal);
  const subject = `to ${symbolAt(picked, cwd)}`;
  if (places.length === 0) {
    return (
      `No references ${subject} found. A use through a subclass or an override counts for that symbol instead; ` +
      "try references on it."
    );
  }

  return placesAnswer(places, "reference", subject, cwd);
}

/** What implements the symbol `pattern` names in `file`: an interface's classes, an abstract method's overrides. */
export async function implementations(
  servers: ServerManager,
  file: string,
  pattern: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const picked = await pickSymbol(servers, file, pattern, cwd, signal);
  const { client, spec } = picked.lookup;
  if (!client.capabilities.implementationProvider) {
    throw new Error(`The ${spec.language} server doesn't find implementations; try references instead.`);
  }

  const { uri } = picked.document;
  const places = await afterIndexing(
    picked.lookup,
    () => client.implementations(uri, picked.symbol.at, signal),
    signal,
  );
  const subject = `of ${symbolAt(picked, cwd)}`;
  if (places.length === 0) return `No implementations ${subject} found.`;

  return placesAnswer(places, "implementation", subject, cwd);
}

/**
 * Where a name used in a file is defined: its first use in the file, or in the symbol `within` names. Each definition
 * inside the session's folder comes as its symbol, with the source on request.
 */
export async function definition(
  servers: ServerManager,
  usage: Usage,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!IDENTIFIER.test(usage.name))
    throw new Error(`name must be one identifier, such as parseConfig; got ${usage.name}.`);

  const { lookup, document, lines } = await usageScope(servers, usage, cwd, signal);
  const where = `${displayPath(usage.file, cwd)}${lines ? `, in ${lines.label}` : ""}`;
  const at = firstUse(document.text, usage.name, lines);
  if (at === undefined) throw new Error(`${usage.name} isn't used in ${where}.`);

  const used = `${displayPath(usage.file, cwd)}:${at.line + 1}`;
  const places = await lookup.client.definitions(document.uri, at, signal);
  if (places.length === 0) {
    return (
      `No definition found for ${usage.name} at ${used}. If that's in a comment or a string, pass the symbol that ` +
      "uses it as name_path."
    );
  }

  const blocks: string[] = [];
  for (const place of places) blocks.push(await definitionBlock(lookup, place, usage.withBody, cwd, signal));
  const header = `${counted(places.length, "definition")} of ${usage.name}, used at ${used}:`;
  return capAnswer(header, blocks, "definition", "Leave out include_body.");
}

/** The usage's server and file, and the symbol's lines when `within` names one. */
async function usageScope(
  servers: ServerManager,
  { file, within }: Usage,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ lookup: ReadyLookup; document: Document; lines?: Lines }> {
  if (within === undefined) {
    const lookup = await currentServer(servers, file);
    return { lookup, document: await fileSymbols(lookup.client, lookup.spec, file, signal) };
  }

  const { lookup, document, symbol } = await pickSymbol(servers, file, within, cwd, signal);
  return { lookup, document, lines: { start: symbol.start, end: symbol.end, label: symbol.path.join("/") } };
}

/** Where `name` first appears as a whole word in `text`, or in `lines` of it. */
function firstUse(text: string, name: string, lines: Lines | undefined): Position | undefined {
  // `$` is the one identifier character a pattern reads as more than itself.
  const escaped = name.replaceAll("$", "\\$");
  const word = new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, "u");
  const all = text.split("\n");
  const start = lines?.start ?? 0;
  const end = lines?.end ?? all.length - 1;

  for (let line = start; line <= end; line++) {
    const match = word.exec(all[line] ?? "");
    if (match) return { line, character: match.index };
  }
  return undefined;
}

/**
 * One definition: its symbol and lines when it's in a file of the server's language inside the session's folder,
 * with the source on request; otherwise its place (`placeLines`).
 */
async function definitionBlock(
  { client, spec }: ReadyLookup,
  place: Location,
  withBody: boolean,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const file = fileURLToPath(place.uri);
  const served = isInside(cwd, file) && languageIdOf(spec, file) !== undefined;
  const target = served ? await fileSymbols(client, spec, file, signal) : undefined;
  const symbol = target && innermostAt(target.symbols, place.range.start.line);
  if (!target || !symbol) return (await placeLines([place], cwd)).join("\n");

  const line = symbolLine(symbol, `${displayPath(file, cwd)}:${lineSpan(symbol)}`);
  return withBody ? `${line}\n${body(target.text, symbol)}\n` : line;
}

/** The deepest symbol whose lines hold `line`; symbols come parents first. */
function innermostAt(symbols: readonly NamedSymbol[], line: number): NamedSymbol | undefined {
  const holding = symbols.filter((symbol) => symbol.start <= line && line <= symbol.end);
  return holding.reduce<NamedSymbol | undefined>(
    (deepest, s) => (s.depth >= (deepest?.depth ?? -1) ? s : deepest),
    undefined,
  );
}

function samePosition(a: Position, b: Position): boolean {
  return a.line === b.line && a.character === b.character;
}

/** A picked symbol as an answer names it: `ServerManager/touch (src/manager.ts:49)`. */
function symbolAt({ document, symbol }: Picked, cwd: string): string {
  return `${symbol.path.join("/")} (${displayPath(fileURLToPath(document.uri), cwd)}:${symbol.at.line + 1})`;
}

/**
 * Places, at least one, as an answer: a counted header, one line per place, and a note when some are outside the
 * session's folder.
 */
async function placesAnswer(places: Location[], noun: string, subject: string, cwd: string): Promise<string> {
  const text = capAnswer(`${counted(places.length, noun)} ${subject}:`, await placeLines(places, cwd), noun, SEE_REST);
  const outside = places.some((place) => !isInside(cwd, fileURLToPath(place.uri)));
  return outside ? `${text}\n\nPlaces outside ${cwd} are shown without their code; read them to see it.` : text;
}

/**
 * One line per place, by file and line: `src/a.ts:12  servers.touch(file);`. Code is shown only for files inside the
 * session's folder, the folder guard's line: the rest are named, and reading them asks.
 */
async function placeLines(places: Location[], cwd: string): Promise<string[]> {
  const spots = places
    .filter((place) => place.uri.startsWith("file:"))
    .map((place) => ({ file: fileURLToPath(place.uri), line: place.range.start.line }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const texts = new Map<string, string[] | undefined>();
  for (const { file } of spots) {
    if (texts.has(file) || !isInside(cwd, file)) continue;
    texts.set(file, await readLines(file));
  }

  return spots.map(({ file, line }) => {
    const where = `${displayPath(file, cwd)}:${line + 1}`;
    const code = texts.get(file)?.[line]?.trim();
    if (!code) return where;
    return `${where}  ${code.length > MAX_CODE_CHARS ? `${code.slice(0, MAX_CODE_CHARS)}…` : code}`;
  });
}

/** A file's lines, or undefined when it can't be read (deleted since the server indexed it). */
async function readLines(file: string): Promise<string[] | undefined> {
  try {
    return (await readFile(file, "utf8")).split("\n");
  } catch {
    return undefined;
  }
}
