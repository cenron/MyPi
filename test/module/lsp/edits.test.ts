import { describe, expect, it } from "vitest";
import type { TextEdit, WorkspaceEdit } from "vscode-languageserver-protocol/node";
import { applyTextEdits, fileEdits } from "#module/lsp/util/edits";

/** An edit replacing line `line`, characters `from` to `to`, with `newText`. */
function edit(line: number, from: number, to: number, newText: string, endLine = line): TextEdit {
  return { range: { start: { line, character: from }, end: { line: endLine, character: to } }, newText };
}

describe("applyTextEdits", () => {
  it.each([
    ["one replacement", "let a = 1;\n", [edit(0, 4, 5, "b")], "let b = 1;\n"],
    ["several on one line, in any order", "a(a)\n", [edit(0, 0, 1, "bb"), edit(0, 2, 3, "bb")], "bb(bb)\n"],
    ["an insert", "ab\n", [edit(0, 1, 1, "X")], "aXb\n"],
    ["a range across lines", "a\nb\nc\n", [edit(0, 1, 0, "", 2)], "ac\n"],
    ["a character past its line's end, as the end", "ab\ncd\n", [edit(0, 9, 9, "!")], "ab!\ncd\n"],
    ["a line past the end, as the text's end", "ab", [edit(5, 0, 0, "!")], "ab!"],
  ])("applies %s", (_case, text, edits, expected) => {
    expect(applyTextEdits(text, edits)).toBe(expected);
  });
});

describe("fileEdits", () => {
  const change = edit(0, 0, 1, "x");

  it("takes changes by file", () => {
    expect(fileEdits({ changes: { "file:///a.ts": [change] } })).toEqual(new Map([["/a.ts", [change]]]));
  });

  it("takes documentChanges over changes, joining a file's edits", () => {
    const workspaceEdit: WorkspaceEdit = {
      changes: { "file:///ignored.ts": [change] },
      documentChanges: [
        { textDocument: { uri: "file:///a.ts", version: 1 }, edits: [change] },
        { textDocument: { uri: "file:///a.ts", version: 1 }, edits: [change] },
      ],
    };
    expect(fileEdits(workspaceEdit)).toEqual(new Map([["/a.ts", [change, change]]]));
  });

  it.each([
    ["a file operation", { documentChanges: [{ kind: "create", uri: "file:///new.ts" }] }, "also create a file"],
    [
      "a snippet edit",
      {
        documentChanges: [
          {
            textDocument: { uri: "file:///a.ts", version: 1 },
            edits: [{ range: change.range, snippet: { kind: "snippet", value: "$1" } }],
          },
        ],
      },
      "holds a snippet",
    ],
  ])("fails on %s", (_case, workspaceEdit, message) => {
    expect(() => fileEdits(workspaceEdit as WorkspaceEdit)).toThrow(message);
  });
});
