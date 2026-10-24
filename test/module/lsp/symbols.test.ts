import { describe, expect, it } from "vitest";
import { type DocumentSymbol, type SymbolInformation, SymbolKind } from "vscode-languageserver-protocol/node";
import { kindName, lastName, matchesNamePath, namedSymbols, plainName } from "#module/lsp/symbols";

const range = (start: number, end = start) => ({
  start: { line: start, character: 0 },
  end: { line: end, character: 0 },
});

function tree(name: string, kind: SymbolKind, lines: [number, number], children: DocumentSymbol[] = []) {
  return { name, kind, range: range(...lines), selectionRange: range(lines[0]), children };
}

describe("matchesNamePath", () => {
  const path = ["ServerManager", "touch"];
  it.each([
    ["a single name at any depth", "touch", true],
    ["a relative path ending the name path", "ServerManager/touch", true],
    ["an absolute path from the top", "/ServerManager/touch", true],
    ["an absolute path that skips the top", "/touch", false],
    ["a relative path that doesn't end it", "ServerManager", false],
    ["a path longer than the name path", "lsp/ServerManager/touch", false],
    ["a different name", "touched", false],
    ["names exactly, not by substring", "touc", false],
    ["nothing for an empty pattern", "/", false],
  ])("matches %s", (_rule, pattern, matches) => {
    expect(matchesNamePath(path, pattern)).toBe(matches);
  });
});

describe("namedSymbols", () => {
  it("gives each symbol of a tree its name path and depth, in order", () => {
    const symbols = namedSymbols([
      tree("ServerManager", SymbolKind.Class, [4, 9], [tree("touch", SymbolKind.Method, [5, 7])]),
      tree("main", SymbolKind.Function, [11, 11]),
    ]);
    expect(symbols).toEqual([
      { path: ["ServerManager"], kind: SymbolKind.Class, start: 4, end: 9, depth: 0 },
      { path: ["ServerManager", "touch"], kind: SymbolKind.Method, start: 5, end: 7, depth: 1 },
      { path: ["main"], kind: SymbolKind.Function, start: 11, end: 11, depth: 0 },
    ]);
  });

  it("leaves out what's declared inside a function, method, or constructor", () => {
    const local = tree("count", SymbolKind.Variable, [6, 6]);
    const symbols = namedSymbols([
      tree(
        "Server",
        SymbolKind.Class,
        [0, 9],
        [
          tree("constructor", SymbolKind.Constructor, [1, 2], [local]),
          tree("touch", SymbolKind.Method, [3, 7], [local]),
          tree("name", SymbolKind.Property, [8, 8]),
        ],
      ),
      tree("main", SymbolKind.Function, [10, 12], [local]),
      tree("config", SymbolKind.Variable, [13, 15], [tree("port", SymbolKind.Property, [14, 14])]),
    ]);
    expect(symbols.map((symbol) => symbol.path.join("/"))).toEqual([
      "Server",
      "Server/constructor",
      "Server/touch",
      "Server/name",
      "main",
      "config",
      "config/port",
    ]);
  });

  it("puts a flat list's container in front, as the parent", () => {
    const flat: SymbolInformation = {
      name: "touch",
      kind: SymbolKind.Method,
      containerName: "Greeter",
      location: { uri: "file:///a.py", range: range(1, 2) },
    };
    expect(namedSymbols([flat])).toEqual([
      { path: ["Greeter", "touch"], kind: SymbolKind.Method, start: 1, end: 2, depth: 0 },
    ]);
  });

  it.each([
    ["a pointer receiver", "(*Server).Touch"],
    ["a value receiver", "(Server).Touch"],
  ])("reads a Go method with %s as Type/Method", (_case, name) => {
    expect(namedSymbols([tree(name, SymbolKind.Method, [6, 8])])[0]?.path).toEqual(["Server", "Touch"]);
  });
});

describe("names", () => {
  it.each([
    ["kindName: a one-word kind", kindName(SymbolKind.Class), "class"],
    ["kindName: a two-word kind", kindName(SymbolKind.EnumMember), "enum member"],
    ["kindName: a kind the protocol doesn't list", kindName(99 as SymbolKind), "symbol"],
    ["lastName: a path's last name", lastName("/ServerManager/touch"), "touch"],
    ["plainName: gopls's Type.Method", plainName("Server.Touch"), "Touch"],
    ["plainName: a plain name", plainName("touch"), "touch"],
  ])("%s", (_case, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
