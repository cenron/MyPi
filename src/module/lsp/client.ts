import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CancellationTokenSource,
  ConfigurationRequest,
  createProtocolConnection,
  DefinitionRequest,
  type Diagnostic,
  DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  DocumentDiagnosticReportKind,
  DocumentDiagnosticRequest,
  type DocumentSymbol,
  DocumentSymbolRequest,
  ExitNotification,
  ImplementationRequest,
  InitializedNotification,
  type InitializeParams,
  InitializeRequest,
  type InitializeResult,
  type Location,
  type LocationLink,
  type Position,
  type ProtocolConnection,
  PublishDiagnosticsNotification,
  ReferencesRequest,
  RenameRequest,
  type ServerCapabilities,
  ShutdownRequest,
  type SymbolInformation,
  type WorkspaceEdit,
  type WorkspaceSymbol,
  WorkspaceSymbolRequest,
} from "vscode-languageserver-protocol/node";
import { errorMessage, isNodeError } from "#core/util/errors";
import type { FileChange } from "./util/walk";

/** How long a server gets to answer `initialize`; a large project can take a while to load. */
const INIT_TIMEOUT_MS = 30_000;
/** How long a server gets to answer `shutdown`, and then to exit, before it's killed. */
const SHUTDOWN_TIMEOUT_MS = 1_000;
/** How much of the server's stderr to keep for the error when it fails to start. */
const STDERR_TAIL_CHARS = 2_000;
/** How long to wait for a server that pushes diagnostics to send them for a file's current text. */
const PUBLISH_TIMEOUT_MS = 10_000;

/** A file as the server last saw it. */
type OpenDocument = { version: number; text: string; languageId: string };

/** A file's diagnostics as a server last pushed them, for the version of its text they were for. */
type Published = { version: number | undefined; diagnostics: Diagnostic[] };

/** A running language server: its process and the JSON-RPC connection to it over stdio. */
export class LspClient {
  /** Resolves once the process has exited, whatever the reason. */
  readonly exited: Promise<void>;
  /** When `initialize` was answered; a server may still be indexing for a while after. */
  readonly startedAt = Date.now();
  /** The files sent to the server, by URI. */
  private readonly documents = new Map<string, OpenDocument>();
  /** The last diagnostics a server pushed per file, by URI; each push is also emitted under its URI. */
  private readonly published = new Map<string, Published>();
  private readonly publishes = new EventEmitter();

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly connection: ProtocolConnection,
    /** What the server said it can do, in its answer to `initialize`. */
    readonly capabilities: ServerCapabilities,
  ) {
    const running = child.exitCode === null && child.signalCode === null;
    this.exited = running ? new Promise((resolve) => child.once("exit", () => resolve())) : Promise.resolve();

    connection.onNotification(PublishDiagnosticsNotification.type, ({ uri, version, diagnostics }) => {
      // Without a version, a push is taken to be for the text sent last.
      this.published.set(uri, { version: version ?? this.documents.get(uri)?.version, diagnostics });
      this.publishes.emit(uri);
    });
  }

  /**
   * Starts `command` in `root` and waits for the `initialize` handshake. Throws, with the end of the server's stderr,
   * when it fails to spawn, exits, or doesn't answer in time; the process is killed first.
   */
  static async start(command: string, args: readonly string[], root: string): Promise<LspClient> {
    const child = spawn(command, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    // An unhandled 'error' event would crash pi; failures while starting are reported by `initialize` below.
    child.on("error", () => {});

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
    });

    const connection = createProtocolConnection(child.stdout, child.stdin);
    // Pyright waits for its settings before it indexes the project; empty settings mean its defaults.
    connection.onRequest(ConfigurationRequest.type, (params) => params.items.map(() => ({})));
    connection.listen();

    let capabilities: ServerCapabilities;
    try {
      ({ capabilities } = await initialize(child, connection, initializeParams(root)));
    } catch (error) {
      child.kill();
      connection.dispose();
      const detail = stderr.trim();
      throw new Error(`${errorMessage(error)}${detail ? `\n${detail}` : ""}`);
    }

    // Built before `initialized`, so a diagnostics push right after it is caught.
    const client = new LspClient(child, connection, capabilities);
    await connection.sendNotification(InitializedNotification.type, {});
    return client;
  }

  /** True once any file has been sent; an `open_file` server (`beforeSearch`) searches only after that. */
  get hasOpenDocuments(): boolean {
    return this.documents.size > 0;
  }

  /**
   * Sends `file`'s text from disk: opened the first time, replaced when it changed since (the agent edits between
   * calls). Returns its URI and the text the server now has.
   */
  async sync(file: string, languageId: string): Promise<{ uri: string; text: string }> {
    const text = await readFile(file, "utf8");
    const uri = pathToFileURL(file).href;
    const open = this.documents.get(uri);

    if (!open) {
      this.documents.set(uri, { version: 1, text, languageId });
      await this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId, version: 1, text },
      });
    } else if (open.text !== text) {
      const version = open.version + 1;
      this.documents.set(uri, { version, text, languageId });
      await this.connection.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }

    return { uri, text };
  }

  /**
   * Sends every open file again that changed on disk since, so a project search doesn't answer from old text. A file
   * that's gone is closed, so the server stops offering its symbols; one that can't be read for another reason is
   * left as the server has it.
   */
  async syncOpen(): Promise<void> {
    for (const [uri, { languageId }] of this.documents) {
      try {
        await this.sync(fileURLToPath(uri), languageId);
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") await this.close(uri);
      }
    }
  }

  /**
   * Tells the server files changed on disk; without it, a server keeps its old copy of a file that isn't open. A
   * "created" report also makes a server re-read a file it already knew.
   */
  async reportFileChanges(changes: readonly FileChange[]): Promise<void> {
    await this.connection.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: changes.map(({ file, type }) => ({ uri: pathToFileURL(file).href, type })),
    });
  }

  /** The symbols of a file sent with `sync`: a tree when the server follows the capability below, else a flat list. */
  async documentSymbols(uri: string, signal?: AbortSignal): Promise<DocumentSymbol[] | SymbolInformation[]> {
    const token = cancelledBy(signal);
    const symbols = await this.connection.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } }, token);
    return symbols ?? [];
  }

  /** The project's symbols the server matches to `query`, often loosely: callers check the names. */
  async workspaceSymbols(query: string, signal?: AbortSignal): Promise<(SymbolInformation | WorkspaceSymbol)[]> {
    const symbols = await this.connection.sendRequest(WorkspaceSymbolRequest.type, { query }, cancelledBy(signal));
    return symbols ?? [];
  }

  /** Where the name at `position` is used, its declarations included. */
  async references(uri: string, position: Position, signal?: AbortSignal): Promise<Location[]> {
    const params = { textDocument: { uri }, position, context: { includeDeclaration: true } };
    return toLocations(await this.connection.sendRequest(ReferencesRequest.type, params, cancelledBy(signal)));
  }

  /** What implements the name at `position`: an interface's classes, an abstract method's overrides. */
  async implementations(uri: string, position: Position, signal?: AbortSignal): Promise<Location[]> {
    const params = { textDocument: { uri }, position };
    return toLocations(await this.connection.sendRequest(ImplementationRequest.type, params, cancelledBy(signal)));
  }

  /** Where the name at `position` is defined. */
  async definitions(uri: string, position: Position, signal?: AbortSignal): Promise<Location[]> {
    const params = { textDocument: { uri }, position };
    return toLocations(await this.connection.sendRequest(DefinitionRequest.type, params, cancelledBy(signal)));
  }

  /**
   * The problems the server finds in a file sent with `sync`, for the text it was last sent: asked for when the
   * server offers it (`diagnosticProvider`), else the server's next push for that text, waited for up to
   * `PUBLISH_TIMEOUT_MS`.
   */
  async diagnostics(uri: string, signal?: AbortSignal): Promise<Diagnostic[]> {
    if (!this.capabilities.diagnosticProvider) return this.pushedDiagnostics(uri, signal);

    const params = { textDocument: { uri } };
    const report = await this.connection.sendRequest(DocumentDiagnosticRequest.type, params, cancelledBy(signal));
    // "unchanged" answers only a request that names an earlier result, which this one never does.
    return report.kind === DocumentDiagnosticReportKind.Full ? report.items : [];
  }

  /** The edits that rename the symbol whose name is at `position`, across the project; null when there's nothing to rename. */
  async rename(uri: string, position: Position, newName: string, signal?: AbortSignal): Promise<WorkspaceEdit | null> {
    const params = { textDocument: { uri }, position, newName };
    return this.connection.sendRequest(RenameRequest.type, params, cancelledBy(signal));
  }

  get isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  /**
   * Asks the server to shut down and exit, as the protocol wants, and kills it if it doesn't within the timeout: the
   * caller is done with it either way. Safe to call twice.
   */
  async stop(): Promise<void> {
    if (this.isRunning) {
      const shutdown = this.connection.sendRequest(ShutdownRequest.type);
      if (await settlesWithin(shutdown, SHUTDOWN_TIMEOUT_MS)) {
        // Rejects only when the pipe is already closed, which the exit wait below handles.
        this.connection.sendNotification(ExitNotification.type).catch(() => {});
      }
      if (!(await settlesWithin(this.exited, SHUTDOWN_TIMEOUT_MS))) this.child.kill();
    }
    this.connection.dispose();
  }

  private async pushedDiagnostics(uri: string, signal?: AbortSignal): Promise<Diagnostic[]> {
    const version = this.documents.get(uri)?.version;
    const timeout = AbortSignal.timeout(PUBLISH_TIMEOUT_MS);
    const waiting = signal ? AbortSignal.any([signal, timeout]) : timeout;

    for (;;) {
      const last = this.published.get(uri);
      if (last && last.version === version) return last.diagnostics;

      try {
        await once(this.publishes, uri, { signal: waiting });
      } catch (error) {
        if (!timeout.aborted) throw error;
        throw new Error(
          `the server sent no diagnostics for ${fileURLToPath(uri)} within ${PUBLISH_TIMEOUT_MS / 1000}s; it may still ` +
            "be loading the project. Try again.",
        );
      }
    }
  }

  private async close(uri: string) {
    this.documents.delete(uri);
    await this.connection.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } });
  }
}

/** The `initialize` request for a server rooted at `root`. Capabilities grow as the tool's actions need them. */
function initializeParams(root: string): InitializeParams {
  const uri = pathToFileURL(root).href;
  return {
    processId: process.pid,
    clientInfo: { name: "MyPi" },
    // Deprecated in favour of workspaceFolders, but still a required field; null leaves the root to the folders.
    rootUri: null,
    workspaceFolders: [{ uri, name: basename(root) }],
    capabilities: {
      // workspaceFolders: servers read the folders above only from a client that says it supports them.
      workspace: { configuration: true, workspaceFolders: true, symbol: {}, didChangeWatchedFiles: {} },
      textDocument: {
        // Without it, servers send a file's symbols as a flat list, losing which class a method is in.
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        references: {},
        implementation: {},
        definition: {},
        // Pull for servers that offer it (tsc), pushes with the text's version for the rest (gopls, Pyright).
        diagnostic: {},
        publishDiagnostics: { versionSupport: true },
        rename: {},
      },
    },
  };
}

/** A server's answer about places as plain locations: a link's target is the name it points at. */
function toLocations(answer: Location | Location[] | LocationLink[] | null): Location[] {
  if (!answer) return [];

  // A cast at the boundary: each item is one or the other, and `targetUri` tells them apart.
  const items = (Array.isArray(answer) ? answer : [answer]) as (Location | LocationLink)[];
  return items.map((item) => ("targetUri" in item ? { uri: item.targetUri, range: item.targetSelectionRange } : item));
}

/** A token that cancels the request when `signal` aborts, such as when the user stops the tool call. */
function cancelledBy(signal: AbortSignal | undefined) {
  const source = new CancellationTokenSource();
  if (signal?.aborted) source.cancel();
  signal?.addEventListener("abort", () => source.cancel(), { once: true });
  return source.token;
}

/** Sends `initialize` and resolves with its answer; rejects when the process fails to spawn, exits, or times out. */
function initialize(
  child: ChildProcessWithoutNullStreams,
  connection: ProtocolConnection,
  params: InitializeParams,
): Promise<InitializeResult> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => settle(new Error(`couldn't start: ${error.message}`));
    const onExit = (code: number | null) => settle(new Error(`exited while starting (code ${code})`));
    const timer = setTimeout(
      () => settle(new Error(`no answer to initialize in ${INIT_TIMEOUT_MS / 1000}s`)),
      INIT_TIMEOUT_MS,
    );

    function settle(outcome: InitializeResult | Error) {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      if (outcome instanceof Error) reject(outcome);
      else resolve(outcome);
    }

    child.once("error", onError);
    child.once("exit", onExit);
    connection.sendRequest(InitializeRequest.type, params).then(
      (result) => settle(result),
      (error: unknown) => settle(new Error(errorMessage(error))),
    );
  });
}

/** True when `promise` settles, either way, within `ms`. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });

  try {
    const settled = promise.then(
      () => true,
      () => true,
    );
    return await Promise.race([settled, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
