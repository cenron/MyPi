import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

/** One search result, the same shape from every backend. Fields a backend didn't get are left out. */
export type SearchResult = { url: string; title?: string; excerpt?: string; published?: string };

/** A search service web_search can call. */
export type SearchBackend = {
  /** Short id, such as `parallel`, for details and messages. */
  id: string;
  /** Display name, such as `Parallel`. */
  name: string;
  /**
   * The pi tool it calls, such as `mcp__parallel__web_search`. web_search's `reachesTools` lists it, so pi waits for
   * the server to connect.
   */
  tool: string;
  /**
   * Searches for `query` through `ctx.executeTool`, so the call runs through pi's tool pipeline and is cancelled
   * with the calling tool. Throws when the search fails.
   */
  search(ctx: ExtensionToolContext, query: string): Promise<SearchResult[]>;
};

/** What web_search keeps about a search, for rendering. `backend` is the backend's `id`. */
export type SearchDetails = { query: string; backend: string; results: SearchResult[] };
