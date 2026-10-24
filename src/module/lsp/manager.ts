import { dirname, extname } from "node:path";
import { FileChangeType } from "vscode-languageserver-protocol/node";
import { errorMessage } from "#core/util/errors";
import { isInside } from "#core/util/paths";
import { LspClient } from "./client";
import { languageIdOf, type ServerSpec } from "./servers";
import { findCommand, markedFolders } from "./util/lookup";
import { fileChanges, modifiedAt, sourceFileTimes } from "./util/walk";

/**
 * One server for one project root: starting (`starting` pending), running (`client`), or failed to start (`error`).
 * Everyone who asks while it starts waits on the same `starting`. `times` holds its source files' modification times
 * as last reported, to find what changed on disk since.
 */
type Instance = {
  spec: ServerSpec;
  root: string;
  starting?: Promise<void>;
  client?: LspClient;
  error?: string;
  times?: Map<string, number>;
};

/** What asking for a server gives: one that's ready, or why there isn't one, for the tool to explain. */
export type Lookup =
  | { kind: "ready"; spec: ServerSpec; root: string; client: LspClient }
  | { kind: "no_server"; extension: string }
  | { kind: "off"; spec: ServerSpec }
  | { kind: "missing"; spec: ServerSpec }
  | { kind: "failed"; spec: ServerSpec; root: string; error: string }
  | { kind: "stopped"; spec: ServerSpec };

/** A lookup that found a running server. */
export type ReadyLookup = Extract<Lookup, { kind: "ready" }>;

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
 * The session's language servers: one per server and project root, started on first use by the `lsp` tool, stopped
 * when it's turned off or the session ends.
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

  /** The server for `file`, started if it isn't running yet, or why there's none. */
  async clientFor(file: string): Promise<Lookup> {
    const spec = this.specs.find((server) => languageIdOf(server, file) !== undefined);
    if (!spec) return { kind: "no_server", extension: extname(file) || file };
    return this.clientIn(spec, dirname(file));
  }

  /**
   * One lookup per server whose root markers mark `dir` (the session's folder, for a search of the whole project),
   * each started if it isn't running yet. Empty when no server's markers are there. Each running server is first told
   * what changed on disk since it last looked, by the agent or anything else (an editor, git), so the search is
   * current.
   */
  async projectClients(dir: string): Promise<Lookup[]> {
    const specs = this.specs.filter((spec) => markedFolders(dir, spec.rootMarkers).length > 0);
    const lookups = await Promise.all(specs.map((spec) => this.clientIn(spec, dir)));
    await Promise.all(lookups.map((lookup) => (lookup.kind === "ready" ? this.reportDiskChanges(lookup) : undefined)));
    return lookups;
  }

  /**
   * Turns off the servers in `ids` and on the rest, stopping the ones turned off. Forgets every failed start, so the
   * next call tries again.
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

  /**
   * Tells each running server whose project holds `file`, and that serves its kind, that it changed on disk or was
   * `created`. Servers that aren't running read it fresh when they start.
   */
  async fileChanged(file: string, created: boolean): Promise<void> {
    const type = created ? FileChangeType.Created : FileChangeType.Changed;
    const time = await modifiedAt(file);

    const reports = [...this.instances.values()]
      .filter(({ spec, root, client }) => client && isInside(root, file) && languageIdOf(spec, file) !== undefined)
      .map((instance) => {
        // Already reported, so the next look at the disk doesn't report it again.
        if (time !== undefined) instance.times?.set(file, time);
        return instance.client?.reportFileChanges([{ file, type }]);
      });
    await Promise.allSettled(reports);
  }

  /**
   * Tells a running server which of its project's source files were created, changed, or deleted since it last looked,
   * before an answer that spans files (a search, references, a rename).
   */
  async reportDiskChanges({ spec, root, client }: ReadyLookup): Promise<void> {
    const instance = this.instances.get(instanceKey(spec, root));
    if (!instance?.times) return;

    const times = await sourceFileTimes(root, Object.keys(spec.languageIds));
    const changes = fileChanges(instance.times, times);
    instance.times = times;
    if (changes.length > 0) await client.reportFileChanges(changes);
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

  /** `spec`'s server for the project `dir` is in: running, started now, or why it can't be. A failed start isn't retried. */
  private async clientIn(spec: ServerSpec, dir: string): Promise<Lookup> {
    if (this.closed) return { kind: "stopped", spec };
    if (this.off.has(spec.id)) return { kind: "off", spec };

    const root = this.rootFor(spec, dir);
    const key = instanceKey(spec, root);

    let instance = this.instances.get(key);
    if (!instance) {
      if (!findCommand(spec.command)) return { kind: "missing", spec };
      instance = { spec, root };
      this.instances.set(key, instance);
      instance.starting = this.start(key, instance);
    }
    await instance.starting;

    if (instance.client) return { kind: "ready", spec, root, client: instance.client };
    if (instance.error !== undefined) return { kind: "failed", spec, root, error: instance.error };
    // Turned off, or the session ended, while it was starting.
    return this.off.has(spec.id) ? { kind: "off", spec } : { kind: "stopped", spec };
  }

  /**
   * The project root for `dir`: its nearest marked folder, or the outermost with `outermostRoot`, else the session's
   * folder. For a folder inside the session's, a marked folder above it doesn't count: the root is where the server
   * reads and the disk check scans, so it never reaches outside the session's folder on its own.
   */
  private rootFor(spec: ServerSpec, dir: string): string {
    let folders = markedFolders(dir, spec.rootMarkers);
    if (isInside(this.cwd, dir)) folders = folders.filter((folder) => isInside(this.cwd, folder));

    return (spec.outermostRoot ? folders.at(-1) : folders[0]) ?? this.cwd;
  }

  private async start(key: string, instance: Instance) {
    const { spec, root } = instance;

    let client: LspClient;
    try {
      client = await LspClient.start(spec.command, spec.args, root);
      // What the server sees now: later looks report what changed since.
      instance.times = await sourceFileTimes(root, Object.keys(spec.languageIds));
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

  /** A server that exits on its own is dropped, so the next call starts a new one. */
  private onExit(key: string, instance: Instance) {
    if (this.instances.get(key) !== instance) return; // stopped on purpose

    this.instances.delete(key);
    this.warn(`LSP: ${instance.spec.language} server in ${instance.root} exited; the next lsp call restarts it.`);
  }
}

function instanceKey(spec: ServerSpec, root: string): string {
  return `${spec.id}\0${root}`;
}
