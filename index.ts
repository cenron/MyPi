import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { MyPi } from "./src/mypi";

export default function (pi: ExtensionAPI) {
  const myPi = new MyPi(pi);

  // Set up our event handlers
  pi.on("session_start", (ev: SessionStartEvent, ctx: ExtensionContext) => myPi.onSessionStart(ev, ctx));
  pi.on("before_agent_start", (ev: BeforeAgentStartEvent, ctx: ExtensionContext) => myPi.onBeforeAgentStart(ev, ctx));
  pi.on("session_shutdown", (ev: SessionShutdownEvent, ctx: ExtensionContext) => myPi.onSessionEnd(ev, ctx));
}
