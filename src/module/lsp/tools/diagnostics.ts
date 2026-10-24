import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-protocol/node";
import type { ServerManager } from "../manager";
import { currentServer, sendFile } from "./document";
import { capAnswer, counted, displayPath } from "./format";

/** Severity names, worst first. A diagnostic without one counts as an error, as most clients show it. */
const SEVERITIES = new Map<DiagnosticSeverity, string>([
  [DiagnosticSeverity.Error, "error"],
  [DiagnosticSeverity.Warning, "warning"],
  [DiagnosticSeverity.Information, "info"],
  [DiagnosticSeverity.Hint, "hint"],
]);

/**
 * The problems the server finds in `file` as it is on disk now, worst first: one line each, `error 12:5  message
 * (source code)`, with a count per severity in the header.
 */
export async function diagnostics(
  servers: ServerManager,
  file: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  const { client, spec } = await currentServer(servers, file);
  const { uri } = await sendFile(client, spec, file);
  const found = (await client.diagnostics(uri, signal)).toSorted(bySeverityThenPlace);
  const from = `${displayPath(file, cwd)}, from the ${spec.language} server`;
  if (found.length === 0) return `No problems in ${from}.`;

  const counts = [...SEVERITIES.values()]
    .map((name) => counted(found.filter((d) => severityName(d) === name).length, name))
    .filter((count) => !count.startsWith("0 "));
  const header = `${counted(found.length, "problem")} (${counts.join(", ")}) in ${from}:`;
  return capAnswer(header, found.map(diagnosticLine), "problem", "Fix the first ones, then ask again.");
}

function severityName(diagnostic: Diagnostic): string {
  return SEVERITIES.get(diagnostic.severity ?? DiagnosticSeverity.Error) ?? "error";
}

function bySeverityThenPlace(a: Diagnostic, b: Diagnostic): number {
  const severity = (a.severity ?? DiagnosticSeverity.Error) - (b.severity ?? DiagnosticSeverity.Error);
  return severity || a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character;
}

/** `error 12:5  Cannot find name 'x'. (ts 2304)`: 1-based, with later lines of the message indented under it. */
function diagnosticLine(diagnostic: Diagnostic): string {
  const { line, character } = diagnostic.range.start;
  const origin = [diagnostic.source, diagnostic.code].filter((part) => part !== undefined && part !== "").join(" ");
  // LSP 3.18 lets a message be Markdown; its text reads the same here.
  const text = typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
  const message = text.trim().replaceAll("\n", "\n    ");
  return `${severityName(diagnostic)} ${line + 1}:${character + 1}  ${message}${origin ? ` (${origin})` : ""}`;
}
