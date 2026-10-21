import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Session } from "#core/session";
import type { Tool } from "./types";

const parameters = Type.Object({
  url: Type.String({ description: "The http(s) URL to fetch." }),
});

/** `web_fetch`: reads a URL and returns its content as markdown. A stub for now; see `docs/tools/web-fetch.md`. */
export function webFetchTool(_session: Session): Tool {
  const definition = defineTool({
    name: "web_fetch",
    label: "Web fetch",
    description: "Fetch a URL and return its content as markdown.",
    parameters,
    annotations: { readOnlyHint: true, openWorldHint: true },
    async execute(_toolCallId, { url }) {
      return { content: [{ type: "text", text: `TODO: fetch ${url}` }], details: undefined };
    },
  });

  return { definition };
}
