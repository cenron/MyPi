import { describe, expect, it } from "vitest";
import { type SymbolInformation, SymbolKind } from "vscode-languageserver-protocol/node";
import { duplicateLocations, isTestFile, newDeclarations, topLevelDeclarations } from "#module/lsp/duplicates";
import type { NamedSymbol } from "#module/lsp/symbols";

function symbol(name: string, depth = 0, kind: SymbolKind = SymbolKind.Function): NamedSymbol {
  return { path: [name], kind, start: 4, end: 4, depth, at: { line: 4, character: 0 } };
}

describe("duplicate rules", () => {
  it.each([
    ["top-level declaration", [symbol("top")], [symbol("top")]],
    ["nested declaration", [symbol("nested", 1)], []],
    ["non-declaration", [symbol("field", 0, SymbolKind.Field)], []],
  ])("selects %s", (_case, input, expected) => {
    expect(topLevelDeclarations(input)).toEqual(expected);
  });

  it.each([
    ["not present in committed text", "fresh", "", [symbol("fresh")]],
    ["already declared in committed text", "retained", "const retained = 1", []],
    // The accepted limit: a name the committed file used at all isn't new.
    ["only used in committed text", "retained", "use(retained);", []],
    ["does not confuse an identifier prefix", "format", "const formatPrice = () => 1", [symbol("format")]],
    ["does not confuse a Unicode identifier suffix", "format", "const formaté = 1", [symbol("format")]],
  ])("finds names %s", (_case, name, committed, expected) => {
    expect(newDeclarations([symbol(name)], committed)).toEqual(expected);
  });

  it.each([
    ["test folder", "/repo/tests/helper.ts", true],
    ["spec suffix", "/repo/src/helper.spec.ts", true],
    ["ordinary source", "/repo/src/helper.ts", false],
  ])("recognizes %s", (_case, path, expected) => expect(isTestFile(path)).toBe(expected));

  it("keeps exact matches in other source files only", () => {
    const results = [
      {
        name: "format",
        location: {
          uri: "file:///repo/src/other.ts",
          range: { start: { line: 8, character: 0 }, end: { line: 8, character: 1 } },
        },
      },
      {
        name: "formatExtra",
        location: {
          uri: "file:///repo/src/no.ts",
          range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
        },
      },
      {
        name: "format",
        location: {
          uri: "file:///repo/src/current.ts",
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
        },
      },
      {
        name: "format",
        location: {
          uri: "file:///repo/node_modules/pkg/index.ts",
          range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } },
        },
      },
    ] as SymbolInformation[];
    expect(duplicateLocations("format", "/repo/src/current.ts", results)).toEqual([
      { file: "/repo/src/other.ts", line: 9 },
    ]);
  });
});
