import { setTimeout as sleep } from "node:timers/promises";
import { displayPath } from "#core/util/paths";
import type { LspClient } from "../client";
import type { Lookup, ReadyLookup, ServerManager } from "../manager";
import { languageIdOf, type ServerSpec } from "../servers";
import { matchesNamePath, type NamedSymbol, namedSymbols } from "../symbols";
import { lineSpan, symbolLine, unavailable } from "./format";

/** How long after a `wait_for_index` server starts an empty answer is asked again: Pyright takes seconds. */
const WARMUP_MS = 5_000;
const RETRY_MS = 500;

/** A file as a server sees it: its URI, the text it was sent, and its symbols with name paths. */
export type Document = { uri: string; text: string; symbols: NamedSymbol[] };

/** The one symbol a name path picks in a file, with the server that serves the file and the file as sent. */
export type Picked = { lookup: ReadyLookup; document: Document; symbol: NamedSymbol };

/** The ready server, or an error that tells the agent what to ask the user. */
export function ready(lookup: Lookup): ReadyLookup {
  if (lookup.kind !== "ready") throw new Error(unavailable(lookup));
  return lookup;
}

/** Sends `file`'s text from disk to the server; its URI and the text sent. */
export async function sendFile(client: LspClient, spec: ServerSpec, file: string) {
  const languageId = languageIdOf(spec, file);
  if (languageId === undefined) throw new Error(`The ${spec.language} server doesn't serve ${file}.`);

  return client.sync(file, languageId);
}

/** Sends `file` to the server and returns it with its symbols. */
export async function fileSymbols(
  client: LspClient,
  spec: ServerSpec,
  file: string,
  signal?: AbortSignal,
): Promise<Document> {
  const { uri, text } = await sendFile(client, spec, file);
  const symbols = namedSymbols(await client.documentSymbols(uri, signal));
  return { uri, text, symbols };
}

/**
 * `ask`'s answer about the project. For a `wait_for_index` server (`beforeSearch`), an empty answer is asked again every
 * `RETRY_MS` until `WARMUP_MS` after it started, since it may only be still indexing.
 */
export async function afterIndexing<T>(
  { client, spec }: ReadyLookup,
  ask: () => Promise<T[]>,
  signal?: AbortSignal,
): Promise<T[]> {
  for (;;) {
    const answer = await ask();
    const warm = Date.now() - client.startedAt > WARMUP_MS;
    if (answer.length > 0 || spec.beforeSearch !== "wait_for_index" || warm) return answer;

    await sleep(RETRY_MS, undefined, { signal });
  }
}

/**
 * The ready server for `file`, after it's told what changed on disk and sent the open files again, for an answer that
 * spans the project (references, a rename): otherwise it answers from old text.
 */
export async function currentServer(servers: ServerManager, file: string): Promise<ReadyLookup> {
  const lookup = ready(await servers.clientFor(file));
  await servers.reportDiskChanges(lookup);
  await lookup.client.syncOpen();
  return lookup;
}

/**
 * The symbol `pattern` names in `file`, for an action about one symbol (references, rename), from a current server
 * (`currentServer`). Fails, saying what to pass instead, when no symbol or more than one matches.
 */
export async function pickSymbol(
  servers: ServerManager,
  file: string,
  pattern: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<Picked> {
  const lookup = await currentServer(servers, file);
  const document = await fileSymbols(lookup.client, lookup.spec, file, signal);
  const matches = document.symbols.filter((symbol) => matchesNamePath(symbol.path, pattern));
  const where = displayPath(file, cwd);

  const [symbol, ...others] = matches;
  if (symbol === undefined) {
    throw new Error(`No symbol matches ${pattern} in ${where}. Check the file's outline for its name path.`);
  }
  if (others.length > 0) {
    const lines = matches.map((match) => symbolLine(match, lineSpan(match)));
    throw new Error(
      `${matches.length} symbols match ${pattern} in ${where}; pass a longer name path:\n${lines.join("\n")}`,
    );
  }

  return { lookup, document, symbol };
}
