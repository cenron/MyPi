import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createProtocolConnection,
  ExitNotification,
  InitializedNotification,
  type InitializeParams,
  InitializeRequest,
  type ProtocolConnection,
  ShutdownRequest,
} from "vscode-languageserver-protocol/node";
import { errorMessage } from "#core/util/errors";

/** How long a server gets to answer `initialize`; a large project can take a while to load. */
const INIT_TIMEOUT_MS = 30_000;
/** How long a server gets to answer `shutdown`, and then to exit, before it's killed. */
const SHUTDOWN_TIMEOUT_MS = 1_000;
/** How much of the server's stderr to keep for the error when it fails to start. */
const STDERR_TAIL_CHARS = 2_000;

/** A running language server: its process and the JSON-RPC connection to it over stdio. */
export class LspClient {
  /** Resolves once the process has exited, whatever the reason. */
  readonly exited: Promise<void>;

  private constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    readonly connection: ProtocolConnection,
  ) {
    this.exited = new Promise((resolve) => child.once("exit", () => resolve()));
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

    const client = new LspClient(child, createProtocolConnection(child.stdout, child.stdin));
    client.connection.listen();

    try {
      await initialize(child, client.connection, initializeParams(root));
      await client.connection.sendNotification(InitializedNotification.type, {});
    } catch (error) {
      child.kill();
      client.connection.dispose();
      const detail = stderr.trim();
      throw new Error(`${errorMessage(error)}${detail ? `\n${detail}` : ""}`);
    }

    return client;
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
}

/** The `initialize` request for a server rooted at `root`. Capabilities grow as the tool's actions need them. */
function initializeParams(root: string): InitializeParams {
  const uri = pathToFileURL(root).href;
  return {
    processId: process.pid,
    clientInfo: { name: "MyPi" },
    rootUri: uri,
    workspaceFolders: [{ uri, name: basename(root) }],
    capabilities: {},
  };
}

/** Sends `initialize` and resolves on its answer; rejects when the process fails to spawn, exits, or times out. */
function initialize(
  child: ChildProcessWithoutNullStreams,
  connection: ProtocolConnection,
  params: InitializeParams,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => settle(new Error(`couldn't start: ${error.message}`));
    const onExit = (code: number | null) => settle(new Error(`exited while starting (code ${code})`));
    const timer = setTimeout(
      () => settle(new Error(`no answer to initialize in ${INIT_TIMEOUT_MS / 1000}s`)),
      INIT_TIMEOUT_MS,
    );

    function settle(error?: Error) {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    }

    child.once("error", onError);
    child.once("exit", onExit);
    connection.sendRequest(InitializeRequest.type, params).then(
      () => settle(),
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
