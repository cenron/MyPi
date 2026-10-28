import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { defineTool, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { displayPath, isInside, resolveToolPath } from "#core/util/paths";
import type { ServerManager } from "../manager";
import { applyTextEdits, fileEdits } from "../util/edits";
import { pickSymbol } from "./document";
import { counted } from "./format";

const parameters = Type.Object({
  action: Type.Literal("rename", { description: "rename: renames a symbol everywhere it's used, through the server." }),
  path: Type.String({ description: "The file that declares the symbol." }),
  name_path: Type.String({
    description: "Which symbol, as the lsp tool's name paths: `touch`, `ServerManager/touch`, `/ServerManager/touch`.",
  }),
  new_name: Type.String({ description: "The symbol's new name." }),
});

/**
 * The `lsp_edit` tool: changes code through the language servers, for what text edits do badly. Not read-only, so
 * Plan mode asks first. Every file it would change must be inside the session's folder, or it changes none.
 */
export function lspEditTool(servers: ServerManager) {
  return defineTool({
    name: "lsp_edit",
    label: "LSP edit",
    description:
      "Rename a symbol across the project through its language server, which knows every real use: imports, " +
      "references, overrides. Safer than find-and-replace, which also hits same-named things.",
    promptSnippet: "Rename a symbol across the project, through language servers",
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const file = resolveToolPath(params.path, cwd, homedir());
      const newName = params.new_name.trim();
      if (newName === "") throw new Error("rename needs a new_name.");

      const { lookup, document, symbol } = await pickSymbol(servers, file, params.name_path, cwd, signal);
      const { client, spec } = lookup;
      if (!client.capabilities.renameProvider) throw new Error(`The ${spec.language} server doesn't rename.`);

      const edit = await client.rename(document.uri, symbol.at, newName, signal);
      const changes = edit ? fileEdits(edit) : new Map();
      const name = symbol.path.join("/");
      if (changes.size === 0) throw new Error(`The ${spec.language} server found nothing to rename for ${name}.`);

      const outside = [...changes.keys()].filter((changed) => !isInside(cwd, changed));
      if (outside.length > 0) {
        throw new Error(
          `Renaming ${name} would also change files outside ${cwd}: ${outside.join(", ")}. Nothing was changed; ` +
            "ask the user how to go on.",
        );
      }

      // Every new text first, so a file that can't be read leaves all of them as they were.
      const texts = new Map<string, string>();
      for (const [changed, edits] of changes) {
        texts.set(changed, applyTextEdits(await readFile(changed, "utf8"), edits));
      }
      for (const [changed, text] of texts) {
        await withFileMutationQueue(changed, () => writeFile(changed, text));
        await servers.fileChanged(changed, false);
      }

      const lines = [...changes]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([changed, edits]) => `${displayPath(changed, cwd)}: ${counted(edits.length, "edit")}`);
      const total = [...changes.values()].reduce((sum, edits) => sum + edits.length, 0);
      const header = `Renamed ${name} to ${newName}: ${counted(total, "edit")} in ${counted(changes.size, "file")}:`;
      return { content: [{ type: "text", text: [header, ...lines].join("\n") }], details: undefined };
    },
  });
}
