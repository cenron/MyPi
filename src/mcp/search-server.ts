import type { McpServer } from "./types";

type SearchServerOptions = {
  name: string;
  url: string;
  description: string;
  hiddenTools?: string[];
  key?: { variable: string; header: string; prefix?: string; keylessHeader?: { name: string; value: string } };
  requiresKey?: boolean;
};

/** Builds the shared deferred search-server config while keeping optional key headers safe for keyless use. */
export function searchServer(options: SearchServerOptions & { requiresKey: true }): McpServer | undefined;
export function searchServer(options: SearchServerOptions): McpServer;
export function searchServer(options: SearchServerOptions): McpServer | undefined {
  const key = options.key;
  const hasKey = key !== undefined && Boolean(process.env[key.variable]);
  if (options.requiresKey && !hasKey) return undefined;

  const headers =
    key && hasKey
      ? { [key.header]: `${key.prefix ?? ""}\${${key.variable}}` }
      : key?.keylessHeader
        ? { [key.keylessHeader.name]: key.keylessHeader.value }
        : undefined;

  return {
    name: options.name,
    config: {
      url: options.url,
      description: options.description,
      exposure: "deferred",
      ...(options.hiddenTools
        ? { toolExposure: Object.fromEntries(options.hiddenTools.map((tool) => [tool, "hidden"])) }
        : {}),
      ...(headers ? { headers } : {}),
    },
  };
}
