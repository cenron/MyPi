// A language server for tests, run as `node fake-server.mjs <mode>`:
// ok answers initialize and shutdown and exits on exit; crash fails before answering; die exits soon after starting;
// stubborn never answers shutdown, so the client has to kill it; needs-open searches nothing until a file is open;
// slow-index searches nothing for its first 700 ms; keeps-deleted goes on offering files reported deleted.
//
// Symbols come from lines like `class Server`, `  method touch`, or `function main`: two spaces of indent nest a
// symbol in the one above. A file's outline reads the text it was last sent. The project search matches loosely, as
// real servers do, over the .ts files under the root: read from disk once, at the first search, and again only when
// the client reports a change (or sends the file), like tsc --lsp. Searching `__config__` returns the
// settings the client answered, as the symbol's name; `__changes__` returns the file changes the client reported.
//
// For the word at a position, over the .ts files under the root (open ones as last sent): references are its other
// whole-word uses, the asked one too with includeDeclaration (none while slow-index indexes); implementations are its other declarations; the definition is its first declaration, sent as a
// location link; a rename edits every use. no-impl offers no implementations. Lines holding `ERROR <text>` or
// `WARN <text>` are diagnostics: pushed with the text's version on open and change, or answered when asked in pull.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ConfigurationRequest,
  createProtocolConnection,
  DefinitionRequest,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticRequest,
  DocumentSymbolRequest,
  ExitNotification,
  FileChangeType,
  ImplementationRequest,
  InitializedNotification,
  InitializeRequest,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RenameRequest,
  ShutdownRequest,
  SymbolKind,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node";

const mode = process.argv[2] ?? "ok";

if (mode === "crash") {
  process.stderr.write("boom: bad config\n");
  process.exit(3);
}

const KINDS = { class: SymbolKind.Class, method: SymbolKind.Method, function: SymbolKind.Function };
const docs = new Map(); // uri → text as last sent
let root = "";
let config;
let indexedAt = 0;
const changes = [];
let disk; // path → text as last read, from the first project search on

const connection = createProtocolConnection(process.stdin, process.stdout);
connection.onRequest(InitializeRequest.type, (params) => {
  root = fileURLToPath(params.workspaceFolders[0].uri);
  const capabilities = {
    documentSymbolProvider: true,
    workspaceSymbolProvider: true,
    referencesProvider: true,
    definitionProvider: true,
    renameProvider: true,
    implementationProvider: mode !== "no-impl",
  };
  if (mode === "pull") capabilities.diagnosticProvider = { interFileDependencies: false, workspaceDiagnostics: false };
  return { capabilities };
});
connection.onNotification(InitializedNotification.type, async () => {
  if (mode === "die") setTimeout(() => process.exit(1), 50);
  indexedAt = Date.now() + (mode === "slow-index" ? 700 : 0);
  config = await connection.sendRequest(ConfigurationRequest.type, { items: [{ section: "fake" }] });
});
connection.onNotification(DidOpenTextDocumentNotification.type, ({ textDocument }) => {
  docs.set(textDocument.uri, textDocument.text);
  publish(textDocument.uri, textDocument.version);
});
connection.onNotification(DidChangeTextDocumentNotification.type, ({ textDocument, contentChanges }) => {
  docs.set(textDocument.uri, contentChanges.at(-1).text);
  publish(textDocument.uri, textDocument.version);
});
connection.onRequest(ReferencesRequest.type, ({ textDocument, position, context }) => {
  if (Date.now() < indexedAt) return [];
  const all = uses(wordAt(textDocument.uri, position));
  return context.includeDeclaration ? all : all.filter((use) => !samePlace(use, textDocument.uri, position));
});
connection.onRequest(ImplementationRequest.type, ({ textDocument, position }) => {
  return declarations(wordAt(textDocument.uri, position)).filter((d) => !samePlace(d, textDocument.uri, position));
});
connection.onRequest(DefinitionRequest.type, ({ textDocument, position }) => {
  const [first] = declarations(wordAt(textDocument.uri, position));
  return first ? [{ targetUri: first.uri, targetRange: first.range, targetSelectionRange: first.range }] : [];
});
connection.onRequest(RenameRequest.type, ({ textDocument, position, newName }) => {
  const changes = {};
  for (const { uri, range } of uses(wordAt(textDocument.uri, position))) {
    changes[uri] = [...(changes[uri] ?? []), { range, newText: newName }];
  }
  return { changes };
});
connection.onRequest(DocumentDiagnosticRequest.type, ({ textDocument }) => {
  return { kind: "full", items: diagnosticsOf(docs.get(textDocument.uri) ?? "") };
});
connection.onNotification(DidCloseTextDocumentNotification.type, ({ textDocument }) => docs.delete(textDocument.uri));
connection.onNotification(DidChangeWatchedFilesNotification.type, (params) => {
  changes.push(...params.changes);
  for (const { uri, type } of params.changes) {
    const file = fileURLToPath(uri);
    if (type === FileChangeType.Deleted) {
      if (mode !== "keeps-deleted") disk?.delete(file);
    } else if (disk?.has(file) || type === FileChangeType.Created) disk?.set(file, readFileSync(file, "utf8"));
  }
});
connection.onRequest(DocumentSymbolRequest.type, ({ textDocument }) => symbolsOf(docs.get(textDocument.uri) ?? ""));
connection.onRequest(WorkspaceSymbolRequest.type, ({ query }) => {
  if (query === "__config__") return [found(JSON.stringify(config), "", pathToFileURL(root).href, 0)];
  if (query === "__changes__") return [found(JSON.stringify(changes), "", pathToFileURL(root).href, 0)];
  if (mode === "needs-open" && docs.size === 0) return [];
  if (Date.now() < indexedAt) return [];

  disk ??= new Map(tsFiles(root).map((file) => [file, readFileSync(file, "utf8")]));
  const open = [...docs.keys()].map((uri) => fileURLToPath(uri)).filter((file) => !disk.has(file));
  return [...disk.keys(), ...open].flatMap((file) => {
    const uri = pathToFileURL(file).href;
    return flatten(symbolsOf(docs.get(uri) ?? disk.get(file) ?? ""), "")
      .filter((symbol) => symbol.name.includes(query) && !symbol.imported)
      .map((symbol) => found(symbol.name, symbol.container, uri, symbol.range.start.line, symbol.kind));
  });
});
connection.onRequest(ShutdownRequest.type, () => (mode === "stubborn" ? new Promise(() => {}) : null));
connection.onNotification(ExitNotification.type, () => {
  if (mode !== "stubborn") process.exit(0);
});
connection.listen();

/** The symbol tree of `text`: each indented line nests in the nearest line above with less indent. */
function symbolsOf(text) {
  const top = [];
  const stack = [];
  text.split("\n").forEach((line, i) => {
    // `import NAME` is listed among the file's symbols, as tsserver lists imports, but isn't a declaration.
    const imported = /^import (\w+)/.exec(line);
    if (imported) {
      const range = { start: { line: i, character: 0 }, end: { line: i, character: line.length } };
      top.push({
        name: imported[1],
        kind: SymbolKind.Function,
        range,
        selectionRange: range,
        children: [],
        imported: true,
      });
      return;
    }
    const match = /^( *)(class|method|function) (\w+)/.exec(line);
    if (!match) return;

    const depth = match[1].length / 2;
    const range = { start: { line: i, character: 0 }, end: { line: i, character: line.length } };
    const nameAt = line.indexOf(match[3], match[1].length + match[2].length);
    const selectionRange = { start: { line: i, character: nameAt }, end: { line: i, character: line.length } };
    const symbol = { name: match[3], kind: KINDS[match[2]], range, selectionRange, children: [] };
    stack.length = depth;
    for (const parent of stack) parent.range = { ...parent.range, end: range.end };
    (stack.at(-1)?.children ?? top).push(symbol);
    stack.push(symbol);
  });
  return top;
}

function flatten(symbols, container) {
  return symbols.flatMap((symbol) => [{ ...symbol, container }, ...flatten(symbol.children, symbol.name)]);
}

function found(name, containerName, uri, line, kind = SymbolKind.Variable) {
  const range = { start: { line, character: 0 }, end: { line, character: 0 } };
  return { name, kind, containerName, location: { uri, range } };
}

/** Pushes a file's diagnostics, unless the client pulls them. */
function publish(uri, version) {
  if (mode === "pull") return;
  void connection.sendNotification(PublishDiagnosticsNotification.type, {
    uri,
    version,
    diagnostics: diagnosticsOf(docs.get(uri) ?? ""),
  });
}

function diagnosticsOf(text) {
  return text.split("\n").flatMap((line, i) => {
    const match = /(ERROR|WARN) (.*)$/.exec(line);
    if (!match) return [];
    const range = { start: { line: i, character: match.index }, end: { line: i, character: line.length } };
    return [{ range, severity: match[1] === "ERROR" ? 1 : 2, message: match[2], source: "fake", code: 7 }];
  });
}

/** The text of every .ts file under the root, open ones as last sent, by URI. */
function texts() {
  const files = new Map(tsFiles(root).map((file) => [pathToFileURL(file).href, readFileSync(file, "utf8")]));
  for (const [uri, text] of docs) files.set(uri, text);
  return files;
}

function wordAt(uri, { line, character }) {
  const text = (docs.get(uri) ?? "").split("\n")[line] ?? "";
  for (const match of text.matchAll(/\w+/g)) {
    if (match.index <= character && character <= match.index + match[0].length) return match[0];
  }
  return "";
}

/** Every whole-word use of `word`, as locations. */
function uses(word) {
  return [...texts()].flatMap(([uri, text]) =>
    text.split("\n").flatMap((line, i) =>
      [...line.matchAll(new RegExp(`\\b${word}\\b`, "g"))].map((match) => ({
        uri,
        range: { start: { line: i, character: match.index }, end: { line: i, character: match.index + word.length } },
      })),
    ),
  );
}

/** The uses of `word` that declare it: `class word`, `method word`, `function word`. */
function declarations(word) {
  const all = texts();
  return uses(word).filter(({ uri, range }) => {
    const line = all.get(uri).split("\n")[range.start.line];
    return /^ *(class|method|function) $/.test(line.slice(0, range.start.character));
  });
}

function samePlace({ uri, range }, otherUri, { line }) {
  return uri === otherUri && range.start.line === line;
}

function tsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}
