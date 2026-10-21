import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Session } from "#core/session";
import { errorMessage } from "#core/util/errors";
import type { Tool } from "./types";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";

/** Registers the built-in tools, then the running modules' tools. Returns the built-ins, whose hooks MyPi runs. */
export function registerTools(pi: ExtensionAPI, session: Session): Tool[] {
  const tools = createTools(session);
  const definitions = [...tools.map((tool) => tool.definition), ...session.moduleManager.getTools()];

  for (const definition of definitions) {
    pi.registerTool(definition);
  }
  return tools;
}

/** Runs each built-in tool's `init()`. Call it once every tool is registered. */
export function initTools(tools: Tool[]) {
  for (const tool of tools) tool.init?.();
}

/** Runs each built-in tool's `shutdown()`. One that throws is logged and doesn't stop the rest from cleaning up. */
export function shutdownTools(tools: Tool[], session: Session) {
  for (const tool of tools) {
    try {
      tool.shutdown?.();
    } catch (error) {
      session.logError(`${tool.definition.name} shutdown: ${errorMessage(error)}`);
    }
  }
}

/** MyPi's built-in tools. Add new ones here. */
const createTools = (session: Session): Tool[] => {
  return [webSearchTool(session), webFetchTool(session)];
};
