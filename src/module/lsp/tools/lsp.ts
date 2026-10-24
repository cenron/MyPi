import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveToolPath } from "#core/util/paths";
import type { ServerManager } from "../manager";
import { diagnostics } from "./diagnostics";
import { findInFile, findInProject, outline } from "./find";
import { definition, implementations, references } from "./navigate";

const parameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("outline"),
      Type.Literal("find_symbol"),
      Type.Literal("references"),
      Type.Literal("implementations"),
      Type.Literal("definition"),
      Type.Literal("diagnostics"),
    ],
    {
      description:
        "outline: a file's symbols as a tree. find_symbol: where a symbol is, by name path. references: where a " +
        "symbol is used. implementations: what implements an interface or abstract member. definition: where a name " +
        "used in a file is defined. diagnostics: a file's errors and warnings, from the server.",
    },
  ),
  path: Type.Optional(
    Type.String({
      description:
        "find_symbol: a file, or a folder inside a project, to search in; without it, the project of the current " +
        "folder is searched. references and implementations: the file that declares the symbol. Every other action: " +
        "the file (required).",
    }),
  ),
  name_path: Type.Optional(
    Type.String({
      description:
        "find_symbol, references, implementations: which symbol. Its names from the top of its file, joined with /: " +
        "`touch` matches that name at any depth, `ServerManager/touch` any path ending with it, " +
        "`/ServerManager/touch` only from the top. Exact names. definition: the symbol to look for the name in.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: "For definition: the name as used in the file, such as `parseConfig`. Its first use is looked up.",
    }),
  ),
  include_body: Type.Optional(
    Type.Boolean({ description: "For find_symbol and definition: add each symbol's source. Off by default." }),
  ),
});

/**
 * The `lsp` tool: outlines, symbols by name path, references, implementations, definitions, and diagnostics, from the
 * language servers. Read-only, so Plan mode allows it. Starts a server on first use.
 */
export function lspTool(servers: ServerManager) {
  const languages = servers.specs.map((spec) => spec.language).join(", ");

  return defineTool({
    name: "lsp",
    label: "LSP",
    description:
      `Code navigation from language servers (${languages}): outline a file, find a symbol by name path, list its ` +
      "references or implementations, jump from a name to its definition, or get a file's errors. Exact where grep " +
      "matches text; use it to see a file's shape or follow code without reading whole files.",
    promptSnippet: "Outline, find symbols, references, definitions, and errors, through language servers",
    parameters,
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const { action, name_path: namePath } = params;
      const cwd = ctx.cwd;
      const path = params.path === undefined ? undefined : resolveToolPath(params.path, cwd, homedir());
      const folder = path !== undefined && (await isFolder(path));

      const file = () => {
        if (path === undefined) throw new Error(`${action} needs a path to a file.`);
        if (folder) throw new Error(`${action} needs a file; ${params.path} is a folder.`);
        return path;
      };
      const pattern = () => {
        if (!namePath) throw new Error(`${action} needs a name_path, such as ServerManager/touch.`);
        return namePath;
      };

      let text: string;
      switch (action) {
        case "outline":
          text = await outline(servers, file(), cwd, signal);
          break;
        case "find_symbol": {
          const query = { pattern: pattern(), withBody: params.include_body === true };
          text =
            path !== undefined && !folder
              ? await findInFile(servers, query, path, cwd, signal)
              : await findInProject(servers, query, path ?? cwd, path !== undefined, cwd, signal);
          break;
        }
        case "references":
          text = await references(servers, file(), pattern(), cwd, signal);
          break;
        case "implementations":
          text = await implementations(servers, file(), pattern(), cwd, signal);
          break;
        case "definition": {
          if (!params.name) throw new Error("definition needs a name, as used in the file.");
          const usage = { file: file(), name: params.name, within: namePath, withBody: params.include_body === true };
          text = await definition(servers, usage, cwd, signal);
          break;
        }
        case "diagnostics":
          text = await diagnostics(servers, file(), cwd, signal);
          break;
      }

      return { content: [{ type: "text", text }], details: undefined };
    },
  });
}

/** True when `path` is a folder; false for a file, or a path that doesn't exist (reading it reports that). */
async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
