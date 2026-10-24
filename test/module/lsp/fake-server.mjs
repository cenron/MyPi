// A language server for tests, run as `node fake-server.mjs <mode>`:
// ok answers initialize and shutdown and exits on exit; crash fails before answering; die exits soon after starting;
// stubborn never answers shutdown, so the client has to kill it.
import {
  createProtocolConnection,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  ShutdownRequest,
} from "vscode-languageserver-protocol/node";

const mode = process.argv[2] ?? "ok";

if (mode === "crash") {
  process.stderr.write("boom: bad config\n");
  process.exit(3);
}

const connection = createProtocolConnection(process.stdin, process.stdout);
connection.onRequest(InitializeRequest.type, () => ({ capabilities: {} }));
connection.onNotification(InitializedNotification.type, () => {
  if (mode === "die") setTimeout(() => process.exit(1), 50);
});
connection.onRequest(ShutdownRequest.type, () => (mode === "stubborn" ? new Promise(() => {}) : null));
connection.onNotification(ExitNotification.type, () => {
  if (mode !== "stubborn") process.exit(0);
});
connection.listen();
