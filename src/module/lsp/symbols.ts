import { type DocumentSymbol, type SymbolInformation, SymbolKind } from "vscode-languageserver-protocol/node";

/** A symbol of one file: its name path from the top of the file, its kind, and its lines (0-based, inclusive). */
export type NamedSymbol = { path: string[]; kind: SymbolKind; start: number; end: number; depth: number };

/** Symbols whose children are their locals: the outline and searches leave those out. */
const CALLABLE_KINDS = new Set<SymbolKind>([SymbolKind.Function, SymbolKind.Method, SymbolKind.Constructor]);

/** gopls names a method `(*Server).Touch` or `(Server).Touch`, at the top of the file, not inside its type. */
const GO_METHOD = /^\(\*?([^()]+)\)\.(.+)$/;

/** Lower-case names for symbol kinds, such as `enum member` for `SymbolKind.EnumMember`. */
const KIND_NAMES = new Map<number, string>(
  Object.entries(SymbolKind).map(([name, kind]) => [kind, name.replace(/(?<=[a-z])(?=[A-Z])/g, " ").toLowerCase()]),
);

/** `kind`'s name, such as `class` or `enum member`, or `symbol` for one the protocol doesn't list. */
export function kindName(kind: SymbolKind): string {
  return KIND_NAMES.get(kind) ?? "symbol";
}

/**
 * A file's symbols in order, each with its name path. Takes the tree a server sends, or the flat list an older one
 * sends, where a symbol's container stands in for its parent. Leaves out what's declared inside a function or method
 * (its locals), which servers such as `tsc --lsp` and Pyright list too.
 */
export function namedSymbols(symbols: readonly (DocumentSymbol | SymbolInformation)[]): NamedSymbol[] {
  return symbols.flatMap((symbol) => ("location" in symbol ? [fromFlat(symbol)] : fromTree(symbol, [], 0)));
}

/**
 * True when `path` matches `pattern`, by Serena's rule: `touch` matches that name at any depth, `Server/touch` any
 * path ending with it, and `/Server/touch` only from the top of the file. Names match exactly.
 */
export function matchesNamePath(path: readonly string[], pattern: string): boolean {
  const names = pattern.split("/").filter(Boolean);
  if (names.length === 0 || names.length > path.length) return false;

  if (pattern.startsWith("/") && names.length !== path.length) return false;
  const tail = path.slice(path.length - names.length);
  return names.every((name, i) => name === tail[i]);
}

/** The last name of a name path pattern, which a project search asks the server for. */
export function lastName(pattern: string): string {
  return pattern.split("/").filter(Boolean).at(-1) ?? "";
}

/** The plain name a project search result stands for: `Server.Touch` (gopls) and `(*Server).Touch` give `Touch`. */
export function plainName(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function fromTree(symbol: DocumentSymbol, parent: string[], depth: number): NamedSymbol[] {
  const path = [...parent, ...ownPath(symbol.name)];
  const self = { path, kind: symbol.kind, start: symbol.range.start.line, end: symbol.range.end.line, depth };
  const children = CALLABLE_KINDS.has(symbol.kind) ? [] : (symbol.children ?? []);
  return [self, ...children.flatMap((child) => fromTree(child, path, depth + 1))];
}

function fromFlat(symbol: SymbolInformation): NamedSymbol {
  const container = symbol.containerName ? [symbol.containerName] : [];
  const { start, end } = symbol.location.range;
  return {
    path: [...container, ...ownPath(symbol.name)],
    kind: symbol.kind,
    start: start.line,
    end: end.line,
    depth: 0,
  };
}

/** The names a symbol adds to the path: one, or two for a Go method, so `Server/Touch` finds it. */
function ownPath(name: string): string[] {
  const method = GO_METHOD.exec(name);
  return method?.[1] && method[2] ? [method[1], method[2]] : [name];
}
