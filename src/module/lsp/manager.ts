import { extname } from "node:path";
import { errorMessage } from "#core/util/errors";
import { LspClient } from "./client";
import type { ServerSpec } from "./servers";
import { findCommand, markedFolders } from "./util/lookup";

/** One server for one project root: starting (no `client`, no `error`), running, or failed to start. */
type Instance = { spec: ServerSpec; root: string; client?: LspClient; error?: string };

/** Where a server stands, for the `/lsp` menu. */
export type ServerStatus = {
  spec: ServerSpec;
  /** Where its command was found; undefined when it isn't installed. */
  path: string | undefined;
  on: boolean;
  running: string[];
  starting: string[];
  failed: { root: string; error: string }[];
};

/**
 * The session's language servers: one per server and project root, started on first use (the `lsp` tool, from slice
 * 2), stopped when it's turned off or the session ends.
 */
export class ServerManager {
  private readonly off = new Set<string>();
  private readonly instances = new Map<string, Instance>();
  private closed = false;

  constructor(
    readonly specs: readonly ServerSpec[],
    private readonly cwd: string,
    private readonly warn: (message: string) => void,
  ) {}

  /**
   * Starts the server for `file`, unless there's none for its extension, it's off or not installed,
   * or one for its root already started or failed. Resolves once that start has finished; failures warn instead of
   * rejecting.
   */
  async touch(file: string): Promise<void> {
    const spec = this.specs.find((server) => server.extensions.includes(extname(file)));
    if (!spec || this.closed || this.off.has(spec.id)) return;

    const folders = markedFolders(file, spec.rootMarkers);
    const root = (spec.outermostRoot ? folders.at(-1) : folders[0]) ?? this.cwd;
    const key = instanceKey(spec, root);
    if (this.instances.has(key) || !findCommand(spec.command)) return;

    const instance: Instance = { spec, root };
    this.instances.set(key, instance);
    await this.start(key, instance);
  }

  /**
   * Turns off the servers in `ids` and on the rest, stopping the ones turned off. Forgets every failed start, so the
   * next touch tries again.
   */
  async setOff(ids: Iterable<string>): Promise<void> {
    this.off.clear();
    for (const id of ids) this.off.add(id);

    const stopping: Promise<void>[] = [];
    for (const [key, instance] of this.instances) {
      if (instance.error === undefined && !this.off.has(instance.spec.id)) continue;
      this.instances.delete(key);
      if (instance.client) stopping.push(instance.client.stop());
    }
    await Promise.allSettled(stopping);
  }

  /** Every server's status, in list order. */
  statuses(): ServerStatus[] {
    return this.specs.map((spec) => {
      const mine = [...this.instances.values()].filter((instance) => instance.spec === spec);
      return {
        spec,
        path: findCommand(spec.command),
        on: !this.off.has(spec.id),
        running: mine.filter((instance) => instance.client).map((instance) => instance.root),
        starting: mine
          .filter((instance) => !instance.client && instance.error === undefined)
          .map((instance) => instance.root),
        failed: mine.flatMap(({ root, error }) => (error === undefined ? [] : [{ root, error }])),
      };
    });
  }

  /** Stops every server and starts no more. For `session_shutdown`; safe to call twice. */
  async stopAll(): Promise<void> {
    this.closed = true;
    const clients = [...this.instances.values()].flatMap((instance) => (instance.client ? [instance.client] : []));
    this.instances.clear();
    await Promise.allSettled(clients.map((client) => client.stop()));
  }

  private async start(key: string, instance: Instance) {
    const { spec, root } = instance;

    let client: LspClient;
    try {
      client = await LspClient.start(spec.command, spec.args, root);
    } catch (error) {
      instance.error = errorMessage(error);
      this.warn(`LSP: ${spec.language} server failed to start in ${root}: ${instance.error}\nRetry with Save in /lsp.`);
      return;
    }

    // Turned off, or the session ended, while it was starting.
    if (this.instances.get(key) !== instance) {
      await client.stop();
      return;
    }

    instance.client = client;
    // Watched, not awaited: `start` is done once the server runs.
    void client.exited.then(() => this.onExit(key, instance));
  }

  /** A server that exits on its own is dropped, so the next touch starts a new one. */
  private onExit(key: string, instance: Instance) {
    if (this.instances.get(key) !== instance) return; // stopped on purpose

    this.instances.delete(key);
    this.warn(`LSP: ${instance.spec.language} server in ${instance.root} exited; it restarts with the next file.`);
  }
}

function instanceKey(spec: ServerSpec, root: string): string {
  return `${spec.id}\0${root}`;
}
