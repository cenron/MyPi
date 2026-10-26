import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type SymbolInformation, SymbolKind, type WorkspaceSymbol } from "vscode-languageserver-protocol/node";
import type { NamedSymbol } from "./symbols";

const DECLARATION_KINDS = new Set<number>([
  SymbolKind.Function,
  SymbolKind.Class,
  SymbolKind.Interface,
  SymbolKind.Enum,
  SymbolKind.Constant,
  SymbolKind.Variable,
]);

/** Source declarations eligible for checking; nested declarations and non-declarations are excluded. */
export function topLevelDeclarations(symbols: readonly NamedSymbol[]): NamedSymbol[] {
  return symbols.filter(({ depth, kind, path }) => depth === 0 && path.length === 1 && DECLARATION_KINDS.has(kind));
}

/** Whether a path is a test fixture, where repeated names are intentional. */
export function isTestFile(file: string): boolean {
  const path = file.split(sep).join("/");
  return /(?:^|\/)(?:test|tests)(?:\/|$)/.test(path) || /\.(?:test|spec)\./.test(path);
}

/**
 * Top-level declarations whose names don't appear in the committed file at all. Plain text on purpose: a name the
 * committed file already used (imported, say) isn't new, so a local copy of an imported helper goes unreported. That's
 * the accepted limit; parsing each language's declarations would cost far more.
 */
export function newDeclarations(current: readonly NamedSymbol[], committed: string): NamedSymbol[] {
  return topLevelDeclarations(current).filter(({ path }) => {
    const name = path.at(-1) ?? "";
    return !new RegExp(`(?<![\\p{ID_Continue}$])${escapeRegex(name)}(?![\\p{ID_Continue}$])`, "u").test(committed);
  });
}

/** Workspace matches in a different file, with an exact symbol name. */
export function duplicateLocations(
  name: string,
  file: string,
  results: readonly (SymbolInformation | WorkspaceSymbol)[],
): { file: string; line: number }[] {
  const own = file;
  return results.flatMap((result) => {
    if (result.name !== name || !result.location || !("uri" in result.location)) return [];
    const path = fileURLToPath(result.location.uri);
    if (path === own || path.split(sep).includes("node_modules") || !("range" in result.location)) return [];
    return [{ file: path, line: result.location.range.start.line + 1 }];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
