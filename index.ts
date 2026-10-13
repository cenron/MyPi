import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { MyPi } from "./src/mypi.ts";

export default function (pi: ExtensionAPI) {
  const myPi = new MyPi(pi);

  // Set up our event handlers
  pi.on("session_start", (ev: SessionStartEvent, ctx: ExtensionContext) =>
    myPi.onSessionStart(ev, ctx),
  );
}
