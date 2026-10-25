import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver-protocol/node";
import type { Problem } from "#core/events";
import type { LspClient } from "../client";
import type { ServerManager } from "../manager";
import type { ServerSpec } from "../servers";
import { currentServer, sendFile } from "./document";
import { capAnswer, counted, displayPath } from "./format";

/** The protocol's severities as MyPi's. A diagnostic without one counts as an error, as most clients show it. */
const SEVERITIES = new Map<DiagnosticSeverity, Problem["severity"]>([
  [DiagnosticSeverity.Error, "error"],
  [DiagnosticSeverity.Warning, "warning"],
  [DiagnosticSeverity.Information, "info"],
  [DiagnosticSeverity.Hint, "hint"],
]);

/** Severities worst first, for sorting and the header's counts. */
const WORST_FIRST: readonly Problem["severity"][] = ["error", "warning", "info", "hint"];

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
  const found = (await fileProblems(client, spec, file, signal)).toSorted(bySeverityThenPlace);
  const from = `${displayPath(file, cwd)}, from the ${spec.language} server`;
  if (found.length === 0) return `No problems in ${from}.`;

  const counts = WORST_FIRST.map((severity) =>
    counted(found.filter((p) => p.severity === severity).length, severity),
  ).filter((count) => !count.startsWith("0 "));
  const header = `${counted(found.length, "problem")} (${counts.join(", ")}) in ${from}:`;
  return capAnswer(header, found.map(problemLine), "problem", "Fix the first ones, then ask again.");
}

/**
 * The problems `client`'s server finds in `file` as it is on disk now, as MyPi's `Problem`s: what the `diagnostics`
 * action shows, and what the module answers the done check with.
 */
export async function fileProblems(
  client: LspClient,
  spec: ServerSpec,
  file: string,
  signal?: AbortSignal,
): Promise<Problem[]> {
  const { uri } = await sendFile(client, spec, file);
  return (await client.diagnostics(uri, signal)).map((diagnostic) => toProblem(file, diagnostic));
}

/** A server's diagnostic as a `Problem`: 1-based, with its source and code as where it came from. */
function toProblem(file: string, diagnostic: Diagnostic): Problem {
  const { line, character } = diagnostic.range.start;
  const origin = [diagnostic.source, diagnostic.code].filter((part) => part !== undefined && part !== "").join(" ");
  // LSP 3.18 lets a message be Markdown; its text reads the same here.
  const message = typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
  return {
    file,
    line: line + 1,
    column: character + 1,
    severity: SEVERITIES.get(diagnostic.severity ?? DiagnosticSeverity.Error) ?? "error",
    message: message.trim(),
    ...(origin ? { origin } : {}),
  };
}

function bySeverityThenPlace(a: Problem, b: Problem): number {
  const severity = WORST_FIRST.indexOf(a.severity) - WORST_FIRST.indexOf(b.severity);
  return severity || a.line - b.line || a.column - b.column;
}

/** `error 12:5  Cannot find name 'x'. (ts 2304)`, with later lines of the message indented under it. */
function problemLine({ severity, line, column, message, origin }: Problem): string {
  return `${severity} ${line}:${column}  ${message.replaceAll("\n", "\n    ")}${origin ? ` (${origin})` : ""}`;
}
