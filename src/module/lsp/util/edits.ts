import { fileURLToPath } from "node:url";
import type { Position, TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol/node";

/**
 * A server's workspace edit as text edits per file. Takes `documentChanges` when the server sends them (the protocol
 * says they win over `changes`). Throws for what lsp_edit doesn't do: creating, renaming, or deleting files, and
 * snippet edits, which are for an editor's cursor.
 */
export function fileEdits(edit: WorkspaceEdit): Map<string, TextEdit[]> {
  const files = new Map<string, TextEdit[]>();
  const add = (uri: string, edits: readonly TextEdit[]) => {
    const file = fileURLToPath(uri);
    files.set(file, [...(files.get(file) ?? []), ...edits]);
  };

  if (edit.documentChanges === undefined) {
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) add(uri, edits);
    return files;
  }

  for (const change of edit.documentChanges) {
    if (!("textDocument" in change)) throw new Error(`the server's edit would also ${change.kind} a file.`);

    const edits = change.edits.map((textEdit) => {
      if (!("newText" in textEdit)) throw new Error("the server's edit holds a snippet, which is for an editor.");
      return textEdit;
    });
    add(change.textDocument.uri, edits);
  }
  return files;
}

/** `text` with `edits` applied. The protocol's edits never overlap and all refer to the text before any of them. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const lineStarts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) lineStarts.push(i + 1);

  /** A position's offset: a character past the end of its line means the line's end, as the protocol says. */
  const offset = ({ line, character }: Position) => {
    const start = lineStarts[line];
    if (start === undefined) return text.length;

    const end = (lineStarts[line + 1] ?? text.length + 1) - 1;
    return Math.min(start + character, end);
  };

  // From the end backwards, so each edit's offsets still hold.
  const sorted = edits
    .map((edit) => ({ start: offset(edit.range.start), end: offset(edit.range.end), newText: edit.newText }))
    .sort((a, b) => b.start - a.start);
  return sorted.reduce((result, { start, end, newText }) => result.slice(0, start) + newText + result.slice(end), text);
}
